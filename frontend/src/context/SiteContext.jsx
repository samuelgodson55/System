import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { api, getActiveSiteId, setActiveSiteId } from '../utils/api'
import { setActiveSiteName } from '../utils/branding'
import { resetFaultSummary } from '../utils/faults'
import { useAuth } from './AuthContext'

/**
 * Which site (store / location) the person is working in.
 *
 *  - Staff: always the one site assigned to their account. They cannot switch.
 *  - Admins: any site, chosen with the switcher in the header; the choice is remembered in this browser.
 *
 * `ready` turns true once the site is known, so nothing loads stock before that (it would briefly show the wrong site).
 * `siteKey` changes whenever the site does: pages are keyed on it so they reload with the new site's data.
 */
const SiteContext = createContext(null)

export function SiteProvider({ children }) {
  const { user } = useAuth()
  // primitives, not the user object: the account is re-read in the background (name edits, recovery codes…)
  // and that must not reload the sites or the stock on screen
  const userId = user?.id || ''
  const userSiteId = user?.siteId || ''
  const isAdmin = user?.role === 'admin'
  // While an admin-issued temporary password is pending the API only answers /auth/*, so sites cannot be
  // read yet. They are loaded as soon as the password has been changed (this flag flips and load() re-runs).
  const mustChange = !!user?.mustChangePassword
  const [sites, setSites] = useState([])
  const [activeId, setActiveId] = useState('')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const lastActive = useRef('')

  const load = useCallback(async () => {
    if (!userId) {
      setSites([])
      setActiveId('')
      setActiveSiteId('')
      setActiveSiteName('')
      setReady(false)
      return
    }
    if (mustChange) {
      setError('')
      setReady(true)
      return
    }
    try {
      const list = await api.getSites()
      setSites(list)
      setError('')
      let next = ''
      if (isAdmin) {
        const stored = getActiveSiteId()
        // the remembered site may have been deleted since; fall back to the first active one
        next = list.some((s) => s.id === stored) ? stored : (list.find((s) => s.isActive) || list[0])?.id || ''
      } else {
        next = userSiteId || list[0]?.id || ''
      }
      setActiveSiteId(isAdmin ? next : '')
      setActiveId(next)
    } catch (e) {
      // A stock page can still try (the server picks the site); show why the switcher is empty.
      setError(e.message || 'Could not load sites')
      setActiveId(isAdmin ? getActiveSiteId() : '')
    } finally {
      setReady(true)
    }
  }, [userId, userSiteId, isAdmin, mustChange])

  useEffect(() => {
    setReady(false)
    load()
  }, [load])

  const activeSite = useMemo(() => sites.find((s) => s.id === activeId) || null, [sites, activeId])

  // keep exports and other non-React code in step with the active site
  useEffect(() => {
    setActiveSiteName(activeSite?.name || '')
  }, [activeSite])
  useEffect(() => {
    if (!ready || !userId) return
    if (lastActive.current && lastActive.current !== activeId) resetFaultSummary()
    lastActive.current = activeId
  }, [activeId, ready, userId])

  const switchSite = useCallback(
    (id) => {
      if (!isAdmin || !sites.some((s) => s.id === id)) return
      setActiveSiteId(id) // before state, so the very next request already carries it
      setActiveId(id)
    },
    [isAdmin, sites]
  )

  // after the Sites page changed something
  const reloadSites = useCallback(async () => {
    try {
      const list = await api.getSites()
      setSites(list)
      if (isAdmin && !list.some((s) => s.id === getActiveSiteId())) {
        const next = (list.find((s) => s.isActive) || list[0])?.id || ''
        setActiveSiteId(next)
        setActiveId(next)
      }
      return list
    } catch {
      return null
    }
  }, [isAdmin])

  const value = useMemo(
    () => ({
      sites,
      activeSite,
      activeSiteId: activeId,
      siteKey: activeId || 'none',
      isMultiSite: sites.length > 1,
      canSwitch: isAdmin && sites.length > 1,
      ready,
      error,
      switchSite,
      reloadSites,
    }),
    [sites, activeSite, activeId, isAdmin, ready, error, switchSite, reloadSites]
  )
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSite must be used within SiteProvider')
  return ctx
}
