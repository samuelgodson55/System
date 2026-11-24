import { useCallback, useLayoutEffect, useState } from 'react'

const GAP = 4 // px between the field and its menu
const MARGIN = 8 // px always kept clear of the screen edge

/**
 * Positions a drop-down menu against its field so it can never run off the screen.
 *
 * The menu is meant to be rendered in a portal with `position: fixed` (so a modal or a scrolling
 * card can't clip it). Its height is capped to the room actually available: it opens downwards
 * when there is space, flips upwards when there is clearly more room above, and scrolls inside
 * itself for anything longer. The position follows the field on scroll / resize.
 *
 *   anchorRef   ref to the field the menu hangs from
 *   open        boolean – nothing is measured while closed
 *   maxHeight   the tallest the menu may ever be (px)
 *   minWidth    the narrowest the menu may be (px) – lets a narrow filter show long names
 */
export default function useAnchoredMenu(anchorRef, open, { maxHeight = 288, minWidth = 0 } = {}) {
  const [style, setStyle] = useState(null)

  const measure = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vv = window.visualViewport
    const vh = vv ? vv.height : window.innerHeight
    const vw = vv ? vv.width : window.innerWidth

    const below = vh - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    // open upwards only when downwards is cramped AND upwards is roomier
    const up = below < Math.min(maxHeight, 200) && above > below
    const room = Math.max(96, up ? above : below)

    const width = Math.min(Math.max(r.width, minWidth), vw - MARGIN * 2)
    const left = Math.max(MARGIN, Math.min(r.left, vw - width - MARGIN))

    setStyle({
      position: 'fixed',
      left,
      width,
      maxHeight: Math.min(maxHeight, room),
      ...(up ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP }),
    })
  }, [anchorRef, maxHeight, minWidth])

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return undefined
    }
    measure()
    // capture = also fires for scrolling inside a modal or any other scroll container
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [open, measure])

  return style
}
