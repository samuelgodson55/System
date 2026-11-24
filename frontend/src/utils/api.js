const API_BASE = import.meta.env.VITE_API_URL || '/api'

function getToken() {
  return localStorage.getItem('inventory_token')
}

// A request that never answers (server down, network dropped) must not leave a button spinning forever.
// Backups, restores and exports legitimately take minutes, so they get a longer allowance.
const DEFAULT_TIMEOUT_MS = 60_000
const LONG_TIMEOUT_MS = 5 * 60_000
const isLongPath = (path) => path.startsWith('/backups') || path.startsWith('/exports')

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), isLongPath(path) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('The server took too long to answer. Check your connection and try again.')
    throw new Error('Cannot reach the server. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 204) return null

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Session expired / token rejected: sign out instead of failing every request
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      localStorage.removeItem('inventory_token')
      localStorage.removeItem('inventory_user')
      if (!window.location.pathname.endsWith('/login')) window.location.assign('/login')
    }
    const err = new Error(data.error || res.statusText || 'Request failed')
    err.status = res.status
    // machine-readable details (e.g. code 'RECIPIENT_EXISTS' + the existing record) for callers that offer a merge
    err.code = data.code
    err.data = data
    throw err
  }
  return data
}

function qs(params = {}) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
  )
  const q = new URLSearchParams(clean).toString()
  return q ? `?${q}` : ''
}

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Fetch an export as a file (authenticated) and return { blob, filename }. */
async function fetchFile(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('inventory_token')
      localStorage.removeItem('inventory_user')
      if (!window.location.pathname.endsWith('/login')) window.location.assign('/login')
    }
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Export failed')
  }
  const cd = res.headers.get('Content-Disposition') || ''
  const m = /filename="([^"]+)"/.exec(cd)
  return { blob: await res.blob(), filename: m ? m[1] : null }
}

export const api = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  updateProfile: (data) =>
    request('/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),

  // Admin recovery codes (one-time codes to get back in after forgetting the password)
  getRecoveryStatus: () => request('/auth/recovery-codes'),
  createRecoveryCodes: (currentPassword) =>
    request('/auth/recovery-codes', { method: 'POST', body: JSON.stringify({ currentPassword }) }),
  recoverAccount: (username, recoveryCode, newPassword) =>
    request('/auth/recover', { method: 'POST', body: JSON.stringify({ username, recoveryCode, newPassword }) }),

  // User management (admin). Every change re-confirms the acting admin's own password.
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetUserPassword: (id, data) =>
    request(`/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify(data) }),
  deleteUser: (id, adminPassword) =>
    request(`/users/${id}`, { method: 'DELETE', body: JSON.stringify({ adminPassword }) }),

  getBranding: () => request('/settings/branding'),
  updateBranding: (data) =>
    request('/settings/branding', { method: 'PUT', body: JSON.stringify(data) }),

  // qs() drops undefined / empty values (URLSearchParams would send them as the text "undefined")
  getItems: (params = {}) => request(`/items${qs(params)}`),
  getStats: () => request('/items/stats'),
  getCategories: () => request('/items/categories'),
  // Editable categories (name, item count); rename moves the items with it
  getCategoryList: () => request('/categories'),
  createCategory: (name) => request('/categories', { method: 'POST', body: JSON.stringify({ name }) }),
  renameCategory: (id, name, merge = false) =>
    request(`/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name, merge }) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),

  // Reusable recipients (new ones are added automatically when stock is issued)
  getRecipients: () => request('/recipients'),
  getRecipientUsage: (id) => request(`/recipients/${id}/usage`),
  getRecipientConflicts: () => request('/recipients/conflicts'),
  updateRecipient: (id, data) => request(`/recipients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getItem: (id) => request(`/items/${id}`),
  createItem: (data) => request('/items', { method: 'POST', body: JSON.stringify(data) }),
  updateItem: (id, data) => request(`/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteItem: (id) => request(`/items/${id}`, { method: 'DELETE' }),

  getUnits: () => request('/units'),
  createUnit: (data) => request('/units', { method: 'POST', body: JSON.stringify(data) }),
  updateUnit: (id, data) => request(`/units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUnit: (id) => request(`/units/${id}`, { method: 'DELETE' }),

  getEvents: () => request('/events'),
  getEvent: (id) => request(`/events/${id}`),
  getEventTransactions: (id) => request(`/events/${id}/transactions`),
  createEvent: (data) => request('/events', { method: 'POST', body: JSON.stringify(data) }),
  updateEvent: (id, data) => request(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),

  getTransactions: (params = {}) => request(`/transactions${qs(params)}`),
  getOutstanding: (itemId, params = {}) => request(`/transactions/outstanding/${itemId}${qs(params)}`),
  // Everything that is out, across all items (Return Stock overview)
  getOutstandingOverview: (params = {}) => request(`/transactions/outstanding${qs(params)}`),
  // Book back everything one person has out for the listed items (all-or-nothing)
  returnBatch: (data) =>
    request('/transactions/return-batch', { method: 'POST', body: JSON.stringify(data) }),
  getDailyIssues: (date, tz) => {
    const q = new URLSearchParams({ date, tz }).toString()
    return request(`/transactions/daily?${q}`)
  },
  // Kits: issue whole sets or single pieces, return, receive loose pieces, repack
  issueKit: (data) =>
    request('/transactions/kit-issue', { method: 'POST', body: JSON.stringify(data) }),
  returnKit: (data) =>
    request('/transactions/kit-return', { method: 'POST', body: JSON.stringify(data) }),
  receiveKitPieces: (data) =>
    request('/transactions/kit-receive', { method: 'POST', body: JSON.stringify(data) }),
  repackKit: (id, sets) =>
    request(`/items/${id}/repack`, { method: 'POST', body: JSON.stringify({ sets }) }),
  // Bulk: many items in one all-or-nothing request (a bad line rejects the batch with err.data.lineErrors)
  bulkIssue: (data) =>
    request('/transactions/bulk-issue', { method: 'POST', body: JSON.stringify(data) }),
  bulkReceive: (data) =>
    request('/transactions/bulk-receive', { method: 'POST', body: JSON.stringify(data) }),
  createTransaction: (data) =>
    request('/transactions', { method: 'POST', body: JSON.stringify(data) }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),

  listBackups: () => request('/backups'),
  createBackup: () => request('/backups', { method: 'POST' }),
  restoreBackup: (filename) =>
    request(`/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' }),
  downloadBackup: (filename) => {
    const token = getToken()
    return fetch(`${API_BASE}/backups/${encodeURIComponent(filename)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  },
  /**
   * Upload a .sql backup (streamed). onProgress receives 0-100.
   * The file is gzip-compressed in the browser first: hosted firewalls (Render/Cloudflare) reject a request
   * body that looks like SQL with a bare 403, and compressed bytes are also several times smaller to send.
   */
  uploadBackup: async (file, onProgress) => {
    let body = file
    let encoding = ''
    if (typeof CompressionStream !== 'undefined' && file.stream) {
      body = await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob()
      encoding = 'gzip'
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API_BASE}/backups/upload`)
      xhr.timeout = LONG_TIMEOUT_MS * 2
      const token = getToken()
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name))
      if (encoding) xhr.setRequestHeader('X-Upload-Encoding', encoding)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onerror = () => reject(new Error('Cannot reach the server. Check your connection and try again.'))
      xhr.ontimeout = () => reject(new Error('The upload took too long. Check your connection and try again.'))
      xhr.onload = () => {
        let data = null
        try {
          data = JSON.parse(xhr.responseText || '')
        } catch {
          /* not JSON: an error page from a proxy / firewall rather than from the API */
        }
        if (xhr.status === 401 && data) {
          localStorage.removeItem('inventory_token')
          localStorage.removeItem('inventory_user')
          window.location.assign('/login')
        }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data || {})
        if (!data?.error) {
          return reject(
            new Error(
              xhr.status === 403
                ? 'The hosting firewall blocked this upload (403). Try again; if it keeps happening, restore with the psql command in RENDER.md.'
                : xhr.status === 413
                  ? 'The file is too large for the server.'
                  : `Upload failed (${xhr.status}).`
            )
          )
        }
        reject(new Error(data.error))
      }
      xhr.send(body)
    })
  },
  deleteBackup: (filename) =>
    request(`/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' }),

  // Faulty-item register
  getFaults: (params = {}) => request(`/faults${qs(params)}`),
  getFaultSummary: () => request('/faults/summary'),
  reportFault: (data) => request('/faults', { method: 'POST', body: JSON.stringify(data) }),
  updateFault: (id, data) => request(`/faults/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  resolveFault: (id, data) => request(`/faults/${id}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
  reopenFault: (id) => request(`/faults/${id}/reopen`, { method: 'POST' }),
  deleteFault: (id) => request(`/faults/${id}`, { method: 'DELETE' }),

  // Exports (server-built, streamed)
  // trailing slash: safe behind proxies that redirect slash-less directory-style paths
  getExportCatalog: () => request('/exports/'),
  getExportRows: (dataset, params = {}) =>
    request(`/exports/${encodeURIComponent(dataset)}${qs({ ...params, format: 'json', tz: browserTz() })}`),
  downloadExport: (dataset, params = {}) =>
    fetchFile(`/exports/${encodeURIComponent(dataset)}${qs({ ...params, format: 'csv', tz: browserTz() })}`),
  downloadFullExport: () => fetchFile('/exports/full'),
}
