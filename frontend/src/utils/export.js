import { getBrandingSnapshot } from './branding'
import { format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'

/**
 * Filter rows by optional date range (inclusive).
 * @param {Array} data
 * @param {string} dateKey - key on each row that holds an ISO date string
 * @param {string|null} fromDate - YYYY-MM-DD
 * @param {string|null} toDate - YYYY-MM-DD
 */
export function filterByDateRange(data, dateKey, fromDate, toDate) {
  if (!fromDate && !toDate) return data
  return data.filter((row) => {
    const raw = row[dateKey]
    if (!raw) return false
    try {
      const d = typeof raw === 'string' ? parseISO(raw) : new Date(raw)
      if (fromDate && toDate) {
        return isWithinInterval(d, {
          start: startOfDay(parseISO(fromDate)),
          end: endOfDay(parseISO(toDate)),
        })
      }
      if (fromDate) return d >= startOfDay(parseISO(fromDate))
      if (toDate) return d <= endOfDay(parseISO(toDate))
      return true
    } catch {
      return false
    }
  })
}

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Spreadsheet apps run text that starts with = + - @ as a formula
const csvSafe = (val) => {
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(val)) return `'${val}`
  return val
}

/** Strip characters that are not allowed in file names on Windows/macOS/Linux. */
export const safeFileName = (name) =>
  String(name || 'export').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').slice(0, 120)

/** Save a Blob as a file. The URL is released after the browser has started the download. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

const csvQuote = (v) => String(v).replace(/"/g, '""')

/** Keep only usable overview entries: [{ label, value }] with a non-empty value. */
export function cleanSummary(summary) {
  if (!Array.isArray(summary)) return []
  return summary.filter((s) => s && s.label != null && s.value != null && String(s.value) !== '')
}

/** Filters may be a string or a list of strings; returns one line of text ('' when none). */
export function describeFilterList(filters) {
  if (!filters) return ''
  const list = Array.isArray(filters) ? filters : [filters]
  return list.filter(Boolean).join('  |  ')
}

export function exportToCSV(data, filename, options = {}) {
  const { fromDate, toDate, dateKey = 'Date', prefiltered = false, title, summary, filters } = options
  let rows = data
  if ((fromDate || toDate) && !prefiltered) {
    rows = filterByDateRange(data, dateKey, fromDate, toDate)
  }

  if (!rows || rows.length === 0) {
    alert('No data to export for the selected date range')
    return
  }

  const headers = Object.keys(rows[0])
  const csvRows = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = csvSafe(row[h] ?? '')
          const str = String(val).replace(/"/g, '""')
          return `"${str}"`
        })
        .join(',')
    ),
  ]

  // Header margin with date range info
  const { companyName, siteLocation } = getBrandingSnapshot()
  const marginLines = []
  if (companyName) marginLines.push(`"Company","${csvQuote(csvSafe(companyName))}"`)
  if (siteLocation) marginLines.push(`"Site","${csvQuote(csvSafe(siteLocation))}"`)
  marginLines.push(`"Export generated","${format(new Date(), 'PPpp')}"`)
  if (fromDate || toDate) {
    marginLines.push(
      `"Date range","${fromDate || '…'} to ${toDate || '…'}"`
    )
  }
  // Overview block: what the report is, what it was filtered by, and the headline figures
  const filterText = describeFilterList(filters)
  if (title) marginLines.splice(companyName && siteLocation ? 2 : companyName || siteLocation ? 1 : 0, 0, `"Report","${csvQuote(csvSafe(title))}"`)
  if (filterText) marginLines.push(`"Filters applied","${csvQuote(csvSafe(filterText))}"`)
  marginLines.push(`"Rows in file","${rows.length}"`)
  const overview = cleanSummary(summary)
  if (overview.length) {
    marginLines.push('')
    marginLines.push('"Report overview"')
    overview.forEach((s) => marginLines.push(`"${csvQuote(csvSafe(s.label))}","${csvQuote(csvSafe(String(s.value)))}"`))
  }
  marginLines.push('') // blank line before table

  // BOM so Excel reads UTF-8 (accents, currency signs) correctly; CRLF per RFC 4180
  const blob = new Blob(
    ['\uFEFF' + [...marginLines, ...csvRows].join('\r\n')],
    { type: 'text/csv;charset=utf-8;' }
  )
  const rangeSuffix =
    fromDate || toDate
      ? `_${fromDate || 'start'}_${toDate || 'end'}`
      : `_${format(new Date(), 'yyyy-MM-dd')}`
  downloadBlob(blob, `${safeFileName(filename)}${rangeSuffix}.csv`)
}

// The built-in PDF fonts only cover Western (WinAnsi) text; swap the few common symbols outside it
const pdfText = (v) =>
  String(v ?? '')
    .replace(/\u2192/g, ' to ')
    .replace(/\u20A6/g, 'NGN ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2022\u00B7]/g, '-')
    .replace(/[^\u0009\u000A\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2026]/g, '?')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Cell text for the PDF: safe characters, tidy whitespace, and IDs split on a hyphen instead of mid-character. */
const pdfCell = (v) => {
  const t = pdfText(v)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return UUID_RE.test(t) ? `${t.slice(0, 18)}\n${t.slice(18)}` : t
}

/** Measure every column once (at 10pt). Widths scale linearly with font size, so this is reused for each size tried. */
function measureColumns(doc, head, body) {
  const MAX_NATURAL = 260 // a single line of notes never needs more than this (at 10pt)
  const MAX_MIN = 90 // very long unbroken tokens may wrap by character beyond this
  doc.setFontSize(10)
  const width = (t) => doc.getTextWidth(t)
  const cols = head.map((h) => {
    doc.setFont('helvetica', 'bold')
    return { min: Math.max(...String(h).split(/\s+/).map(width), 0), natural: width(String(h)) }
  })
  doc.setFont('helvetica', 'normal')
  const seen = head.map(() => new Map()) // repeated cells (names, units, types) are measured once
  for (const row of body) {
    for (let c = 0; c < cols.length; c++) {
      const cell = String(row[c] ?? '')
      if (!cell || seen[c].has(cell)) continue
      const m = { min: 0, natural: 0 }
      for (const line of cell.split('\n')) {
        m.natural = Math.max(m.natural, width(line))
        for (const w of line.split(' ')) m.min = Math.max(m.min, width(w))
      }
      seen[c].set(cell, true)
      cols[c].natural = Math.max(cols[c].natural, m.natural)
      cols[c].min = Math.max(cols[c].min, m.min)
    }
  }
  return cols.map((x) => ({ min: Math.min(x.min, MAX_MIN), natural: Math.min(Math.max(x.natural, x.min), MAX_NATURAL) }))
}

/**
 * Work out a width for every column so nothing is squeezed into a one-letter-wide strip.
 *  - each column is at least as wide as its longest word (or header), so words never break mid-word
 *  - short columns (dates, quantities) keep their natural width; long text (notes) takes the spare room
 * Returns null when even the minimum widths do not fit, so the caller can try a smaller font.
 */
function fitColumns(measured, fontSize, available, pad) {
  const k = fontSize / 10
  const cols = measured.map((x) => ({ min: x.min * k + pad * 2 + 1, natural: x.natural * k + pad * 2 + 1 }))
  const minTotal = cols.reduce((n, x) => n + x.min, 0)
  if (minTotal > available) return null
  const naturalTotal = cols.reduce((n, x) => n + x.natural, 0)
  if (naturalTotal <= available) {
    // everything fits on one line: share the spare room evenly so the table spans the page
    const extra = (available - naturalTotal) / cols.length
    return cols.map((x) => x.natural + extra)
  }
  // otherwise start from the minimums and hand out the remaining room to the columns that want more
  const spare = available - minTotal
  const want = cols.reduce((n, x) => n + (x.natural - x.min), 0) || 1
  return cols.map((x) => x.min + (spare * (x.natural - x.min)) / want)
}

/**
 * "Report overview": a grid of headline figures drawn above the table.
 * Returns the y position to continue from. Draws nothing when there is no summary.
 */
function drawOverview(doc, items, { x, y, width }) {
  if (items.length === 0) return y // keep old look for callers that give no summary
  const tiles = items
  const gap = 8
  const minTile = 112
  const maxPerRow = Math.max(2, Math.floor((width + gap) / (minTile + gap)))
  const rowsNeeded = Math.ceil(tiles.length / maxPerRow)
  const perRow = Math.ceil(tiles.length / rowsNeeded) // even rows instead of one stray tile
  const tileW = (width - gap * (perRow - 1)) / perRow
  // value: one line at up to 13pt; a long value shrinks, then wraps (max 2 lines) instead of spilling out of its tile
  const innerW = tileW - 12
  const fitted = tiles.map((t) => {
    const value = pdfText(String(t.value))
    doc.setFont('helvetica', 'bold')
    let size = 13
    for (; size >= 8; size -= 1) {
      doc.setFontSize(size)
      if (doc.getTextWidth(value) <= innerW) return { lines: [value], size }
    }
    doc.setFontSize(9)
    const wrapped = doc.splitTextToSize(value, innerW)
    const lines = wrapped.length > 2 ? [wrapped[0], `${String(wrapped[1]).slice(0, -1)}...`] : wrapped
    return { lines, size: 9 }
  })
  const tileH = fitted.some((f) => f.lines.length > 1) ? 54 : 42

  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(30, 41, 59)
  doc.text('Report overview', x, y + 8)
  y += 14
  tiles.forEach((t, i) => {
    const cx = x + (i % perRow) * (tileW + gap)
    const cy = y + Math.floor(i / perRow) * (tileH + gap)
    doc.setFillColor(248, 250, 252).setDrawColor(226, 232, 240).setLineWidth(0.6)
    doc.roundedRect(cx, cy, tileW, tileH, 3, 3, 'FD')
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(100, 116, 139)
    const label = doc.splitTextToSize(pdfText(t.label).toUpperCase(), innerW)[0] || ''
    doc.text(label, cx + 6, cy + 12)
    const { lines, size } = fitted[i]
    doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(30, 41, 59)
    doc.text(lines, cx + 6, cy + 30, { lineHeightFactor: 1.2 })
  })
  const used = Math.ceil(tiles.length / perRow) * (tileH + gap)
  return y + used + 4
}

/**
 * Build a real PDF and save it as a file (no print dialog, no popup window).
 * The PDF library is loaded on demand so it does not add to the app's initial download.
 * Resolves true when the download was started. Failures are reported with an alert.
 */
export async function exportToPDF(title, headers, rows, filename, options = {}) {
  const { fromDate, toDate, summary, filters, rowKinds } = options
  try {
    const [pdfLib, tableLib] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const jsPDF = pdfLib.jsPDF || pdfLib.default?.jsPDF || pdfLib.default
    // The plugin is a CommonJS/UMD bundle: the function can sit on `default` or `default.default`
    const autoTable = [tableLib.default, tableLib.default?.default, tableLib.autoTable].find((f) => typeof f === 'function')
    if (!jsPDF || !autoTable) throw new Error('PDF library failed to load')
    // wider reports get a bigger sheet instead of cramming columns: A4 portrait, A4 landscape, then A3 landscape
    const paper = headers.length > 12 ? 'a3' : 'a4'
    const doc = new jsPDF({ orientation: headers.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: paper })
    const margin = 40
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const { companyName, siteLocation } = getBrandingSnapshot()

    let y = margin
    if (companyName) {
      doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(30, 41, 59)
      doc.text(pdfText(companyName), margin, y + 10)
      y += 18
    }
    if (siteLocation) {
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(100, 116, 139)
      doc.text(pdfText(siteLocation), margin, y + 10)
      y += 14
    }
    if (companyName || siteLocation) {
      doc.setDrawColor(226, 232, 240).setLineWidth(1).line(margin, y + 6, pageW - margin, y + 6)
      y += 20
    }
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(30, 41, 59)
    doc.text(pdfText(title), margin, y + 12)
    y += 22
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100, 116, 139)
    doc.text(`Generated on ${format(new Date(), 'PPpp')}`, margin, y + 8)
    y += 12
    if (fromDate || toDate) {
      doc.text(`Date range: ${fromDate || '...'} to ${toDate || '...'}`, margin, y + 8)
      y += 12
    }
    const filterText = describeFilterList(filters)
    if (filterText) {
      const lines = doc.splitTextToSize(`Filters: ${pdfText(filterText)}`, pageW - margin * 2)
      doc.text(lines, margin, y + 8)
      y += 12 * lines.length
    }
    y = drawOverview(doc, cleanSummary(summary), { x: margin, y: y + 6, width: pageW - margin * 2 })

    const head = headers.map(pdfText)
    const body = rows.map((r) => head.map((_, c) => pdfCell(r[c])))
    const pad = 4
    // try 8.5pt, then step the font down until every column's minimum width fits the page
    const measured = measureColumns(doc, head, body)
    let fontSize = 8.5
    let widths = null
    for (; fontSize >= 5.5; fontSize -= 0.5) {
      widths = fitColumns(measured, fontSize, pageW - margin * 2, pad)
      if (widths) break
    }
    if (!widths) {
      fontSize = 5.5
      const each = (pageW - margin * 2) / head.length
      widths = head.map(() => each)
    }
    const columnStyles = Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w }]))

    autoTable(doc, {
      startY: y + 10,
      head: [head],
      body,
      margin: { left: margin, right: margin, bottom: margin + 10 },
      tableWidth: pageW - margin * 2,
      columnStyles,
      styles: { font: 'helvetica', fontSize, cellPadding: pad, valign: 'top', overflow: 'linebreak', lineColor: [221, 221, 221], lineWidth: 0.5, textColor: [30, 41, 59] },
      headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold', valign: 'middle' },
      showHead: 'everyPage', // header row repeats on every page
      rowPageBreak: 'avoid',
      // kits (group rows) stand out; the pieces under them read as secondary
      didParseCell: (d) => {
        if (d.section !== 'body' || !rowKinds) return
        const kind = rowKinds[d.row.index]
        if (kind === 'group') {
          d.cell.styles.fontStyle = 'bold'
          d.cell.styles.fillColor = [248, 250, 252]
        } else if (kind === 'child') {
          d.cell.styles.textColor = [71, 85, 105]
        }
      },
    })

    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(100, 116, 139)
      doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 20, { align: 'right' })
      doc.text(pdfText([companyName, title].filter(Boolean).join('  -  ')).slice(0, 110), margin, pageH - 20)
    }

    const rangeSuffix = fromDate || toDate ? `_${fromDate || 'start'}_${toDate || 'end'}` : `_${format(new Date(), 'yyyy-MM-dd')}`
    downloadBlob(doc.output('blob'), `${safeFileName(filename)}${rangeSuffix}.pdf`)
    return true
  } catch (err) {
    console.error('PDF export failed', err)
    alert('Could not create the PDF. Please try again, or use CSV.')
    return false
  }
}
