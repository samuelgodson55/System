import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from '../utils/api'
import { useAuth } from './AuthContext'
import { useSite } from './SiteContext'

const InventoryContext = createContext(null)

const ITEM_PAGE = 500

/** Load every item, page by page, so nothing is silently cut off at the page size. */
async function fetchAllItems() {
  const first = await api.getItems({ limit: ITEM_PAGE, page: 1 })
  if (Array.isArray(first)) return first
  const all = [...(first.items || [])]
  const pages = Math.ceil((first.total || 0) / ITEM_PAGE)
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, k) => api.getItems({ limit: ITEM_PAGE, page: k + 2 }))
    )
    for (const r of rest) all.push(...(r.items || []))
  }
  return all
}

export function InventoryProvider({ children }) {
  const { user } = useAuth()
  const { ready: siteReady, siteKey } = useSite()
  const [items, setItems] = useState([])
  const [units, setUnits] = useState([])
  const [events, setEvents] = useState([])
  const [serverCategories, setServerCategories] = useState([])
  const [categoryRecords, setCategoryRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // a slow answer for the site just left must never overwrite the one now shown
  const loadId = useRef(0)

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([])
      setUnits([])
      setEvents([])
      setServerCategories([])
      setCategoryRecords([])
      setLoading(false)
      return
    }
    // wait until the working site is known (an admin's saved choice), so the wrong site never flashes
    if (!siteReady) {
      setLoading(true)
      return
    }
    const mine = ++loadId.current
    setLoading(true)
    setError(null)
    try {
      const [itemsRes, unitsRes, eventsRes, catsRes] = await Promise.all([
        fetchAllItems(),
        api.getUnits(),
        api.getEvents(),
        api.getCategoryList().catch(() => []),
      ])
      if (mine !== loadId.current) return
      setItems(itemsRes)
      setCategoryRecords(catsRes)
      setServerCategories(catsRes.map((c) => c.name))
      setUnits(unitsRes)
      setEvents(eventsRes)
    } catch (e) {
      if (mine !== loadId.current) return
      console.error(e)
      setError(e.message)
    } finally {
      if (mine === loadId.current) setLoading(false)
    }
    // siteKey: switching site reloads everything for the new site
  }, [user, siteReady, siteKey])

  // Switching site: drop the previous site's stock and events straight away rather than showing them while loading
  useEffect(() => {
    setItems([])
    setEvents([])
  }, [siteKey])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Every category in use (from the server's full list plus anything just created/edited)
  const categories = useMemo(() => {
    const seen = new Map()
    for (const c of [...serverCategories, ...items.map((i) => i.category)]) {
      const t = (c || '').trim()
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [serverCategories, items])

  // Re-read categories and items after a category was renamed / merged / removed, without the
  // full-page loading state (a rename changes the category text on many items at once).
  const refreshCategories = useCallback(async () => {
    const [all, cats] = await Promise.all([fetchAllItems(), api.getCategoryList()])
    setItems(all)
    setCategoryRecords(cats)
    setServerCategories(cats.map((c) => c.name))
  }, [])

  // Units
  const addUnit = useCallback(async (unit) => {
    const created = await api.createUnit(unit)
    setUnits((prev) => [...prev, created])
    return created
  }, [])

  const updateUnit = useCallback(async (id, updates) => {
    const updated = await api.updateUnit(id, updates)
    setUnits((prev) => prev.map((u) => (u.id === id ? updated : u)))
    return updated
  }, [])

  const deleteUnit = useCallback(async (id) => {
    await api.deleteUnit(id)
    setUnits((prev) => prev.filter((u) => u.id !== id))
    // the server drops the unit from every item that offered it
    setItems((prev) => prev.map((i) => ({ ...i, unitIds: (i.unitIds || []).filter((u) => u !== id) })))
  }, [])

  // Events
  const addEvent = useCallback(async (event) => {
    const created = await api.createEvent(event)
    setEvents((prev) => [...prev, created])
    return created
  }, [])

  const updateEvent = useCallback(async (id, updates) => {
    const updated = await api.updateEvent(id, updates)
    setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)))
    return updated
  }, [])

  const deleteEvent = useCallback(async (id) => {
    await api.deleteEvent(id)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }, [])

  // Items
  const addItem = useCallback(async (item) => {
    const created = await api.createItem(item)
    setItems((prev) => [...prev, created])
    return created
  }, [])

  const updateItem = useCallback(async (id, updates) => {
    const updated = await api.updateItem(id, updates)
    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)))
    return updated
  }, [])

  const deleteItem = useCallback(async (id) => {
    await api.deleteItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  // Re-read a single item (stock, outstanding, kit pieces) instead of the whole list
  const refreshItem = useCallback(async (id) => {
    const fresh = await api.getItem(id)
    setItems((prev) => (prev.some((i) => i.id === id) ? prev.map((i) => (i.id === id ? fresh : i)) : [...prev, fresh]))
    return fresh
  }, [])

  // Transactions are not kept in memory (the ledger can grow without limit): pages that
  // show history ask the server for just the rows they need.
  const addTransaction = useCallback(
    async (txn) => {
      const created = await api.createTransaction(txn)
      await refreshItem(txn.itemId)
      return created
    },
    [refreshItem]
  )

  // Kit operations touch several ledger rows and one item's stock counters
  const withItemReload = useCallback(
    (fn) => async (d) => {
      const result = await fn(d)
      if (d?.itemId) await refreshItem(d.itemId)
      return result
    },
    [refreshItem]
  )

  const issueKit = useCallback((d) => withItemReload(api.issueKit)(d), [withItemReload])
  const returnKit = useCallback((d) => withItemReload(api.returnKit)(d), [withItemReload])
  const receiveKitPieces = useCallback((d) => withItemReload(api.receiveKitPieces)(d), [withItemReload])
  const returnBatch = useCallback(
    async (d) => {
      const result = await api.returnBatch(d)
      await Promise.all((result.returned || []).map((r) => refreshItem(r.itemId)))
      return result
    },
    [refreshItem]
  )
  const repackKit = useCallback(
    async (id, n) => {
      const result = await api.repackKit(id, n)
      await refreshItem(id)
      return result
    },
    [refreshItem]
  )

  // Deleting a ledger line changes stock, so re-read the item it belonged to
  const deleteTransaction = useCallback(
    async (id, itemId) => {
      await api.deleteTransaction(id)
      if (itemId) await refreshItem(itemId)
    },
    [refreshItem]
  )

  // Re-read every item quietly (no full-page spinner): used after a bulk issue / receive,
  // which can change the stock of many items at once
  const reloadItems = useCallback(async () => {
    setItems(await fetchAllItems())
  }, [])

  const getUnit = useCallback(
    (unitId) => units.find((u) => u.id === unitId),
    [units]
  )

  // Base units in ONE `unitId` for this item (items can override a unit's default factor)
  const unitFactor = useCallback(
    (unitId, item) => {
      if (item?.unitFactors && item.unitFactors[unitId] != null) return item.unitFactors[unitId]
      const unit = units.find((u) => u.id === unitId)
      return unit ? unit.conversionFactor : 1
    },
    [units]
  )

  const convertToBase = useCallback(
    (quantity, unitId, item) => Math.round(quantity * unitFactor(unitId, item) * 1e10) / 1e10, // 10 decimals: 1 piece = 1/48 pack
    [unitFactor]
  )

  const convertFromBase = useCallback(
    (baseQuantity, unitId, item) => baseQuantity / unitFactor(unitId, item),
    [unitFactor]
  )

  return (
    <InventoryContext.Provider
      value={{
        items,
        units,
        events,
        categories,
        categoryRecords,
        refreshCategories,
        loading,
        error,
        refresh,
        addUnit,
        updateUnit,
        deleteUnit,
        addEvent,
        updateEvent,
        deleteEvent,
        addItem,
        updateItem,
        deleteItem,
        addTransaction,
        issueKit,
        returnKit,
        returnBatch,
        receiveKitPieces,
        repackKit,
        deleteTransaction,
        refreshItem,
        reloadItems,
        unitFactor,
        getUnit,
        convertToBase,
        convertFromBase,
      }}
    >
      {children}
    </InventoryContext.Provider>
  )
}

export function useInventory() {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error('useInventory must be used within InventoryProvider')
  return ctx
}
