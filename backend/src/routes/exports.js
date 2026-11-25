/**
 * Data exports.
 *
 *   GET /api/exports                      catalogue of datasets this user may export
 *   GET /api/exports/full                 whole database as JSON (admin) – portability, not a restore file
 *   GET /api/exports/:dataset?format=csv  download (default)
 *   GET /api/exports/:dataset?format=json { title, columns, rows, truncated } – used to build PDF reports
 *
 * Overview: both formats carry a short "overview" (headline figures + filters used). CSV puts it in a block of lines
 * above the table; pass overview=0 for a plain header + rows file. JSON returns it as { overview, filters }.
 *
 * Filters (all optional, see services/exports.js): columns (comma-separated column keys), from, to, tz, search, category, itemType,
 * type, status, itemId, eventId, outType, days, lowStock, topLevel.
 */
import { Router } from 'express'
import { query } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { requireSite } from '../middleware/site.js'
import {
  DATASETS, ExportError, buildOverview, catalog, csvLine, describeFilters, fullExportChunks, parseParams, pickColumns,
} from '../services/exports.js'

const router = Router()
router.use(authenticate)

// The PDF path loads rows into the browser, so it is capped; CSV and JSON-full are not.
const JSON_ROW_CAP = 5000

const slug = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

async function fileStem(dataset, siteName = '') {
  let company = ''
  try {
    const { rows } = await query(`SELECT value FROM app_settings WHERE key = 'company_name'`)
    company = slug(rows[0]?.value)
  } catch {
    /* branding is cosmetic */
  }
  const day = new Date().toISOString().slice(0, 10)
  const site = slug(siteName)
  return `${company ? `${company}_` : ''}${site ? `${site}_` : ''}${dataset}_${day}`
}

function setDownloadHeaders(res, filename, type) {
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Accel-Buffering', 'no') // let nginx pass the stream straight through
}

/** Write with back-pressure; resolves false if the client went away. */
function makeWriter(req, res) {
  let closed = false
  res.on('close', () => { closed = true })
  req.on('aborted', () => { closed = true })
  return {
    get closed() { return closed },
    async write(chunk) {
      if (closed) return false
      if (!res.write(chunk)) {
        await new Promise((resolve) => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve() }
          res.once('drain', done)
          res.once('close', done)
        })
      }
      return !closed
    },
  }
}

function audit(req, what) {
  console.log(`[export] ${req.user?.username || 'unknown'} → ${what}`)
}

function fail(res, e, fallback) {
  if (e instanceof ExportError) return res.status(e.status).json({ error: e.message })
  console.error(e)
  if (res.headersSent) return res.destroy(e) // mid-stream: abort so the download is not mistaken for complete
  return res.status(500).json({ error: fallback })
}

router.get('/', (req, res) => {
  res.json({ datasets: catalog(req.user?.role === 'admin') })
})

router.get('/full', requireAdmin, async (req, res) => {
  try {
    audit(req, 'full database (JSON)')
    const w = makeWriter(req, res)
    const name = `${await fileStem('full-data')}.json`
    const chunks = fullExportChunks()
    // read the first chunk before sending headers so a database error is still a clean 500
    const first = await chunks.next()
    setDownloadHeaders(res, name, 'application/json; charset=utf-8')
    if (!(await w.write(first.value))) return
    for await (const c of chunks) if (!(await w.write(c))) return
    res.end()
  } catch (e) {
    fail(res, e, 'Export failed')
  }
})

// every dataset except the admin-only whole-database export is limited to ONE site: the request's site
router.get('/:dataset', requireSite, async (req, res) => {
  try {
    const dataset = DATASETS[req.params.dataset]
    if (!dataset) return res.status(404).json({ error: 'Unknown export' })
    if (dataset.adminOnly && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }
    const format = String(req.query.format || 'csv').toLowerCase()
    if (!['csv', 'json'].includes(format)) return res.status(400).json({ error: 'format must be csv or json' })

    const params = { ...(await parseParams(req.query)), siteId: req.siteId }
    const batches = dataset.rows(params)
    const columns = pickColumns(dataset, req.query.columns) // optional ?columns=key1,key2
    const keys = columns.map((c) => c.key)
    const wantOverview = !['0', 'false', 'no'].includes(String(req.query.overview ?? '1').toLowerCase())
    audit(req, `${req.params.dataset} (${format}) site=${req.site?.name}`)

    if (format === 'json') {
      const rows = []
      const all = [] // every row, so the overview is not limited by the PDF cap (the ledger streams and uses SQL instead)
      let truncated = false
      for await (const batch of batches) {
        if (!dataset.streams) all.push(...batch)
        for (const r of batch) {
          if (rows.length >= JSON_ROW_CAP) { truncated = true; break }
          rows.push(r)
        }
        if (truncated) break
      }
      const overview = wantOverview ? await buildOverview(req.params.dataset, params, dataset.streams ? null : all) : []
      res.setHeader('Cache-Control', 'no-store')
      return res.json({
        id: req.params.dataset,
        title: dataset.title,
        site: req.site?.name || '',
        columns,
        rows,
        truncated,
        cap: JSON_ROW_CAP,
        overview,
        filters: describeFilters(dataset, params),
        generatedAt: new Date().toISOString(),
      })
    }

    // CSV: UTF-8 with a byte-order mark (so Excel reads accents/₦ correctly) and CRLF line ends
    const w = makeWriter(req, res)
    const name = `${await fileStem(req.params.dataset, req.site?.name)}.csv`
    const iter = batches[Symbol.asyncIterator]()
    let next = await iter.next() // first batch before headers: query errors stay clean 500s
    setDownloadHeaders(res, name, 'text/csv; charset=utf-8')
    // Overview block above the table (report name, filters, headline figures). Skipped with overview=0.
    let head = ''
    if (wantOverview) {
      const overview = await buildOverview(req.params.dataset, params, dataset.streams || next.done ? null : next.value)
      const lines = [['Report', dataset.title]]
      try {
        const { rows: co } = await query(`SELECT key, value FROM app_settings WHERE key IN ('company_name', 'site_location')`)
        const set = Object.fromEntries(co.map((r) => [r.key, r.value]))
        if (set.company_name) lines.unshift(['Company', set.company_name])
        const siteLine = req.site?.name || set.site_location
        if (siteLine) lines.splice(set.company_name ? 1 : 0, 0, ['Site', siteLine])
      } catch { /* branding is cosmetic */ }
      lines.push(['Generated', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'])
      lines.push(['Filters applied', describeFilters(dataset, params).join(' | ')])
      if (overview.length) {
        lines.push([])
        lines.push(['Report overview'])
        overview.forEach((o) => lines.push([o.label, o.value]))
      }
      lines.push([])
      head = lines.map((l) => csvLine(l)).join('')
    }
    let ok = await w.write('﻿' + head + csvLine(columns.map((c) => c.label)))
    while (ok && !next.done) {
      ok = await w.write(next.value.map((r) => csvLine(keys.map((k) => r[k]))).join(''))
      if (ok) next = await iter.next()
    }
    if (ok) res.end()
  } catch (e) {
    fail(res, e, 'Export failed')
  }
})

export default router
