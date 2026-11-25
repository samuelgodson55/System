import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'

/**
 * Shared, tiny store of "open faults per item" so the sidebar badge, the inventory list, the
 * dashboard and the issue screen all show the same numbers without each fetching on their own.
 * It is purely informational: if the request fails the app simply shows no fault badges.
 */
const EMPTY = { open: 0, usable: 0, unusable: 0, itemsAffected: 0, byItem: {} }
let summary = EMPTY
let inflight = null
let lastFetch = 0
const listeners = new Set()

const emit = () => listeners.forEach((l) => l())

/** Drop cached numbers and reload: called when the working site changes. */
export function resetFaultSummary() {
  summary = EMPTY
  lastFetch = 0
  emit()
  return refreshFaultSummary()
}

export function refreshFaultSummary() {
  if (inflight) return inflight
  inflight = api
    .getFaultSummary()
    .then((s) => {
      lastFetch = Date.now()
      summary = { ...EMPTY, ...s, byItem: s.byItem || {} }
      emit()
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useFaultSummary() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => summary
  )
  useEffect(() => {
    // mounting many badges at once (a list) must not refetch every time
    if (Date.now() - lastFetch > 5000) refreshFaultSummary()
  }, [])
  return snap
}

export const RESOLUTIONS = [
  ['repaired', 'Repaired'],
  ['replaced', 'Replaced'],
  ['written_off', 'Written off / discarded'],
  ['no_fault', 'No fault found'],
]
export const resolutionLabel = (v) => RESOLUTIONS.find(([k]) => k === v)?.[1] || v || ''

/** Name of what is faulty, e.g. "80-in-1 Tool Kit › Ratchet". */
export const faultTarget = (f) => (f.componentName ? `${f.itemName} › ${f.componentName}` : f.itemName)
