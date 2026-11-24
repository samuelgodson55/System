import { api } from './api'

/**
 * Column choices for server-built reports.
 *  - The catalogue (which columns each report has) is fetched once and shared.
 *  - A person's choice is remembered per report in this browser. It is checked against the
 *    current catalogue every time, so a renamed/removed column can never break an export.
 */
let catalogPromise = null

export function getExportCatalog() {
  if (!catalogPromise) {
    catalogPromise = api
      .getExportCatalog()
      .then((r) => r.datasets || [])
      .catch((e) => {
        catalogPromise = null // allow a retry next time
        throw e
      })
  }
  return catalogPromise
}

const key = (dataset) => `export_columns:${dataset}`

/** Saved column keys for a report, or null when the person has not customised it. */
export function loadSavedColumns(dataset, validKeys) {
  try {
    const raw = JSON.parse(localStorage.getItem(key(dataset)) || 'null')
    if (!Array.isArray(raw)) return null
    const valid = raw.filter((k) => validKeys.includes(k))
    return valid.length ? valid : null
  } catch {
    return null
  }
}

export function saveColumns(dataset, keys) {
  try {
    if (keys) localStorage.setItem(key(dataset), JSON.stringify(keys))
    else localStorage.removeItem(key(dataset))
  } catch {
    /* private mode / storage full: the choice just is not remembered */
  }
}
