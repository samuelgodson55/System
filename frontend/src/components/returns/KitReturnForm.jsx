import { useState, useEffect } from 'react'
import { RotateCcw, Minus, Plus } from 'lucide-react'
import { useInventory } from '../../context/InventoryContext'
import { useAuth } from '../../context/AuthContext'

/**
 * Return form for a kit: how many complete sets come back, plus a checklist of every
 * piece this person still has. Anything not ticked back stays outstanding against them.
 */
export default function KitReturnForm({ kit, balance, onCancel, onDone }) {
  const { user } = useAuth()
  const { returnKit } = useInventory()
  // 'sets' = hand back whole set(s); 'pieces' = hand back only the pieces named (sets stay out).
  // Opening from a single piece, or when no complete set is out, starts in pieces mode.
  const [mode, setMode] = useState(balance.focusComponentId || balance.outstanding === 0 ? 'pieces' : 'sets')
  const piecesOnly = mode === 'pieces'
  const [sets, setSets] = useState(String(balance.outstanding))
  const [qty, setQty] = useState({})
  const [notes, setNotes] = useState('')
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const defaults = (n) =>
    Object.fromEntries(
      balance.components.map((c) => [c.componentId, String(Math.min(c.outstanding, n * c.quantityPerKit))])
    )
  // Pieces-only starts with nothing ticked (except the piece that was clicked): the person
  // handing items back must say exactly what they returned.
  const piecesStart = () =>
    Object.fromEntries(
      balance.components.map((c) => [
        c.componentId,
        c.componentId === balance.focusComponentId ? String(c.outstanding) : '0',
      ])
    )
  useEffect(() => {
    setQty(piecesOnly ? piecesStart() : defaults(balance.outstanding))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance])

  const switchMode = (m) => {
    setMode(m)
    setErr('')
    if (m === 'pieces') { setSets('0'); setQty(piecesStart()) }
    else { setSets(String(balance.outstanding)); setQty(defaults(balance.outstanding)) }
  }

  const n = piecesOnly ? 0 : Number(sets) || 0
  const missing = balance.components
    .map((c) => ({ ...c, gap: n * c.quantityPerKit - (Number(qty[c.componentId]) || 0) }))
    .filter((c) => c.gap > 0)
  const totalBack = balance.components.reduce((t, c) => t + (Number(qty[c.componentId]) || 0), 0)
  const stillOut = balance.components.reduce((t, c) => t + c.outstanding - (Number(qty[c.componentId]) || 0), 0)

  const changeSets = (v) => {
    setSets(v)
    const next = Number(v)
    if (Number.isInteger(next) && next >= 0 && next <= balance.outstanding) setQty(defaults(next))
  }
  const returnEverything = () => {
    setSets(String(balance.outstanding))
    setQty(Object.fromEntries(balance.components.map((c) => [c.componentId, String(c.outstanding)])))
  }

  // +/- buttons: always a whole number between 0 and what is still out for that piece
  const step = (c, delta) => {
    const cur = Number(qty[c.componentId]) || 0
    const next = Math.min(c.outstanding, Math.max(0, (Number.isInteger(cur) ? cur : 0) + delta))
    setQty({ ...qty, [c.componentId]: String(next) })
  }
  const focused = balance.focusComponentId
    ? balance.components.find((c) => c.componentId === balance.focusComponentId)
    : null

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!Number.isInteger(n) || n < 0 || n > balance.outstanding) {
      return setErr(`Sets must be between 0 and ${balance.outstanding}`)
    }
    const lines = []
    for (const c of balance.components) {
      const v = Number(qty[c.componentId]) || 0
      if (!Number.isInteger(v) || v < 0 || v > c.outstanding) {
        return setErr(`${c.name}: enter a whole number up to ${c.outstanding}`)
      }
      if (v > 0) lines.push({ componentId: c.componentId, quantity: v })
    }
    if (!n && !lines.length) return setErr('Nothing is being returned')
    setBusy(true)
    try {
      const res = await returnKit({
        itemId: kit.id,
        sets: n,
        lines,
        recipient: balance.recipient,
        department: balance.department || '',
        notes,
        performedBy: user?.name || 'Unknown',
      })
      onDone({
        sets: n,
        pieces: totalBack,
        missing: res.missing || [],
        autoRepacked: res.autoRepacked || 0,
        piecesOnly,
        returnedNames: balance.components
          .filter((c) => (Number(qty[c.componentId]) || 0) > 0)
          .map((c) => `${Number(qty[c.componentId])} × ${c.name}`),
        remaining: balance.components
          .filter((c) => c.outstanding - (Number(qty[c.componentId]) || 0) > 0)
          .map((c) => `${c.outstanding - (Number(qty[c.componentId]) || 0)} × ${c.name}`),
      })
    } catch (e2) {
      setErr(e2.message || 'Return failed')
    } finally {
      setBusy(false)
    }
  }

  const shown = balance.components.filter((c) =>
    c.name.toLowerCase().includes(filter.trim().toLowerCase())
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <p><span className="text-slate-500">Kit:</span> <strong>{kit.name}</strong></p>
        <p className="mt-1">
          <span className="text-slate-500">From:</span> <strong>{balance.recipient}</strong>
          {balance.department ? ` · ${balance.department}` : ''}
        </p>
        <p className="mt-1">
          <span className="text-slate-500">Still out:</span>{' '}
          <strong className="text-amber-700">
            {balance.outstanding} {balance.outstanding === 1 ? 'set' : 'sets'}
          </strong>
          {' · '}
          <strong className="text-amber-700">
            {balance.components.reduce((t, c) => t + c.outstanding, 0)} pieces
          </strong>
        </p>
      </div>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {balance.outstanding > 0 && (
        <div role="group" aria-label="What is coming back" className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {[['sets', 'Whole set(s)'], ['pieces', 'Specific pieces only']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => switchMode(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {!piecesOnly && (
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">Complete sets coming back</label>
          <input
            type="number"
            min="0"
            max={balance.outstanding}
            step="1"
            className="input"
            value={sets}
            disabled={balance.outstanding === 0}
            onChange={(e) => changeSets(e.target.value)}
          />
        </div>
        <button type="button" className="pb-2 text-xs text-primary-600 hover:underline" onClick={returnEverything}>
          Return everything
        </button>
      </div>
      )}
      {piecesOnly && focused && (
        <div className="rounded-lg border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm text-slate-700">
          Returning <strong>{focused.name}</strong>: <strong className="tabular-nums">{Number(qty[focused.componentId]) || 0}</strong> of{' '}
          <strong className="tabular-nums">{focused.outstanding}</strong>.
          <span className="block text-xs text-slate-500">
            Only part of it came back? Lower the number below. The rest stays recorded against{' '}
            {balance.recipient} until it is returned.
          </span>
        </div>
      )}
      {piecesOnly && (
        <p className="text-xs text-slate-500">
          Enter how many of each piece came back. Anything not entered stays recorded against{' '}
          <strong>{balance.recipient}</strong>.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Check the pieces received</label>
          <span className="text-xs text-slate-500">{totalBack} pieces back</span>
        </div>
        {balance.components.length > 8 && (
          <input
            className="input py-1.5"
            placeholder="Filter pieces…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {shown.map((c) => {
            const v = Number(qty[c.componentId]) || 0
            return (
              <div key={c.componentId} className={`flex items-center justify-between gap-3 px-3 py-2 ${v < c.outstanding ? 'bg-amber-50/50' : ''}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm">{c.name}</p>
                  <p className="text-xs text-slate-400">
                    {c.outstanding} out
                    {v > 0 && v < c.outstanding && (
                      <span className="font-medium text-amber-700"> · {c.outstanding - v} will stay out</span>
                    )}
                  </p>
                </div>
                <button type="button" className="text-xs text-primary-600 hover:underline"
                  onClick={() => setQty({ ...qty, [c.componentId]: String(c.outstanding) })}>
                  All
                </button>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => step(c, -1)} disabled={v <= 0}
                    aria-label={`One fewer ${c.name}`}
                    className="rounded-md p-1.5 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    max={c.outstanding}
                    step="1"
                    inputMode="numeric"
                    className="input w-16 py-1.5 text-right"
                    value={qty[c.componentId] ?? ''}
                    autoFocus={c.componentId === balance.focusComponentId}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setQty({ ...qty, [c.componentId]: e.target.value })}
                    aria-label={`Returning ${c.name}`}
                  />
                  <button type="button" onClick={() => step(c, 1)} disabled={v >= c.outstanding}
                    aria-label={`One more ${c.name}`}
                    className="rounded-md p-1.5 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
          {balance.components.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-slate-400">No pieces are outstanding.</p>
          )}
        </div>
      </div>

      {n > 0 && missing.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Incomplete set: {missing.map((m) => `${m.gap} × ${m.name}`).join(', ')} will stay
          outstanding against {balance.recipient}. The returned pieces go back to store as loose pieces.
        </p>
      )}
      {stillOut > 0 && (n === 0 || missing.length === 0) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {stillOut} piece(s) will remain outstanding against {balance.recipient}:{' '}
          {balance.components
            .filter((c) => c.outstanding - (Number(qty[c.componentId]) || 0) > 0)
            .map((c) => `${c.outstanding - (Number(qty[c.componentId]) || 0)} × ${c.name}`)
            .join(', ')}.
        </p>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium">Notes</label>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Complete set / bit broken"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          <RotateCcw className="h-4 w-4" />
          {busy ? 'Saving…' : 'Confirm return'}
        </button>
      </div>
    </form>
  )
}
