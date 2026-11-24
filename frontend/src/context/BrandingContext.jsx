import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../utils/api'
import { setBrandingSnapshot, DEFAULT_APP_NAME } from '../utils/branding'

const BrandingContext = createContext(null)

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({ companyName: '', siteLocation: '' })

  const apply = useCallback((b) => {
    const next = { companyName: b?.companyName || '', siteLocation: b?.siteLocation || '' }
    setBrandingSnapshot(next)
    setBranding(next)
    document.title = next.companyName
      ? `${next.companyName} · ${DEFAULT_APP_NAME}`
      : DEFAULT_APP_NAME
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await api.getBranding())
    } catch {
      /* branding is cosmetic: keep defaults */
    }
  }, [apply])

  useEffect(() => {
    refresh()
  }, [refresh])

  const save = async (data) => {
    const saved = await api.updateBranding(data)
    apply(saved)
    return saved
  }

  return (
    <BrandingContext.Provider
      value={{
        ...branding,
        displayName: branding.companyName || 'Inventory',
        save,
        refresh,
      }}
    >
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const ctx = useContext(BrandingContext)
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider')
  return ctx
}
