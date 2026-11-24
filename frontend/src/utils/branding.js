// Plain module-level copy of the branding so non-React code (CSV / PDF export) can read it.
// BrandingContext keeps it in sync.
let current = { companyName: '', siteLocation: '' }

export const setBrandingSnapshot = (b) => {
  current = { companyName: b?.companyName || '', siteLocation: b?.siteLocation || '' }
}
export const getBrandingSnapshot = () => current

export const DEFAULT_APP_NAME = 'Inventory Manager'
