// Plain module-level copy of the branding so non-React code (CSV / PDF export) can read it.
// BrandingContext keeps it in sync.
let current = { companyName: '', siteLocation: '' }
// Name of the site being worked in (SiteContext keeps it in sync). It replaces the free-text "Site location"
// on exports, so every report says which site it is for.
let siteName = ''

export const setBrandingSnapshot = (b) => {
  current = { companyName: b?.companyName || '', siteLocation: b?.siteLocation || '' }
}
export const setActiveSiteName = (name) => {
  siteName = name || ''
}
export const getBrandingSnapshot = () => ({ ...current, siteLocation: siteName || current.siteLocation })

export const DEFAULT_APP_NAME = 'Inventory Manager'
