import { Router } from 'express'
import { query } from '../db/pool.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = Router()

const KEYS = { companyName: 'company_name', siteLocation: 'site_location' }
const LIMITS = { companyName: 120, siteLocation: 200 }

async function readBranding() {
  const { rows } = await query(
    'SELECT key, value FROM app_settings WHERE key = ANY($1)',
    [Object.values(KEYS)]
  )
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    companyName: map[KEYS.companyName] || '',
    siteLocation: map[KEYS.siteLocation] || '',
  }
}

// Public on purpose: the login page shows the company name before anyone is signed in.
router.get('/branding', async (_req, res) => {
  try {
    res.json(await readBranding())
  } catch (e) {
    console.error(e)
    // Branding is cosmetic; never block the app because of it
    res.json({ companyName: '', siteLocation: '' })
  }
})

router.put('/branding', authenticate, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const updates = []
    for (const field of Object.keys(KEYS)) {
      if (body[field] === undefined) continue
      const value = String(body[field] ?? '').replace(/\s+/g, ' ').trim()
      if (value.length > LIMITS[field]) {
        return res.status(400).json({ error: `${field === 'companyName' ? 'Company name' : 'Site location'} must be ${LIMITS[field]} characters or fewer` })
      }
      updates.push([KEYS[field], value])
    }
    for (const [key, value] of updates) {
      await query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      )
    }
    res.json(await readBranding())
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to save branding' })
  }
})

export default router
