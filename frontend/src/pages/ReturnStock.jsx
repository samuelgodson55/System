import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, ArrowUpFromLine, X } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import Modal from '../components/Modal'
import KitReturnForm from '../components/returns/KitReturnForm'
import SimpleReturnForm from '../components/returns/SimpleReturnForm'
import ReturnAllModal from '../components/returns/ReturnAllModal'
import OutstandingOverview from '../components/returns/OutstandingOverview'
import ReturnByItem from '../components/returns/ReturnByItem'
import { hasComponents } from '../utils/kits'
import { plural } from '../utils/returns'

const TABS = [
  { id: 'out', label: 'Everything out' },
  { id: 'item', label: 'Find by item' },
]

function SuccessBanner({ success, onDismiss, onIssueInstead }) {
  const s = success
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sky-800">
      <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        {s.kind === 'kit' && s.piecesOnly && (
          <>
            <p>
              <strong>{s.recipient}</strong> returned {s.returnedNames.join(', ')} of <strong>{s.item}</strong>.
            </p>
            {s.remaining.length > 0 && (
              <p className="mt-1 text-xs">
                Still out with {s.recipient}: {s.remaining.join(', ')}.
              </p>
            )}
          </>
        )}
        {s.kind === 'kit' && !s.piecesOnly && (
          <p>
            <strong>{s.recipient}</strong> returned{' '}
            {s.sets > 0 && <strong>{plural(s.sets, 'set', 'sets')} </strong>}({s.pieces} pieces) of{' '}
            <strong>{s.item}</strong>
            {s.missing.length > 0 && ` — incomplete, missing: ${s.missing.join(', ')}`}.
          </p>
        )}
        {s.kind === 'kit' && s.autoRepacked > 0 && (
          <p className="mt-1 text-xs">
            Loose pieces in store now make {plural(s.autoRepacked, 'complete set', 'complete sets')} – stock was updated automatically.
          </p>
        )}
        {s.kind === 'simple' && (
          <p>
            <strong>{s.recipient}</strong> returned <strong>{s.qty} {s.unit}</strong> of <strong>{s.item}</strong>
            {s.consumable && ' — added back to stock'}.
          </p>
        )}
        {s.kind === 'batch' && (
          <>
            <p>
              <strong>{s.recipient}</strong> returned {plural(s.returned.length, 'item', 'items')}:{' '}
              {s.returned.map((r) => r.itemName).join(', ')}.
            </p>
            {s.returned.some((r) => r.missing?.length) && (
              <p className="mt-1 text-xs">
                Incomplete kits:{' '}
                {s.returned.filter((r) => r.missing?.length).map((r) => `${r.itemName} (missing ${r.missing.join(', ')})`).join('; ')}
              </p>
            )}
            {s.skipped.length > 0 && (
              <p className="mt-1 text-xs">Already returned: {s.skipped.map((r) => r.itemName).join(', ')}.</p>
            )}
          </>
        )}
        {s.exchange && (
          <button type="button" onClick={() => onIssueInstead(s.exchange)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100">
            <ArrowUpFromLine className="h-3.5 w-3.5" /> Issue something else to {s.exchange.recipient}
          </button>
        )}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded p-1 text-sky-600 hover:bg-sky-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export default function ReturnStock() {
  const { items } = useInventory()
  const navigate = useNavigate()

  const [tab, setTab] = useState('out')
  const [active, setActive] = useState(null) // { item, balance }
  const [bulk, setBulk] = useState(null) // a person's group (return everything)
  const [success, setSuccess] = useState(null)
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  // A row from "Everything out" carries the balance; the item itself comes from the live list
  const openLine = (line, opts = {}) => {
    const item = items.find((i) => i.id === line.itemId)
    if (!item) return setNotice('That item could not be found – reload the page and try again.')
    setNotice('')
    setActive({
      item,
      balance: {
        recipient: line.recipient,
        department: line.department,
        outstanding: line.outstanding,
        components: line.components,
        lastIssuedAt: line.lastIssuedAt,
        focusComponentId: opts.componentId,
      },
    })
  }
  const openBalance = ({ item, balance }) => { setNotice(''); setActive({ item, balance }) }

  const finish = async (banner) => {
    setSuccess(banner)
    setActive(null)
    setBulk(null)
    reload()
  }

  const issueInstead = ({ recipient, department }) => {
    const q = new URLSearchParams({ recipient, ...(department ? { department } : {}) })
    navigate(`/issue?${q.toString()}`)
  }

  const kit = active && hasComponents(active.item)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Return Stock</h1>
        <p className="text-sm text-slate-500">
          See everything that is out and return it in one tap. Reusable items, tool kits and
          unused consumables can all come back.
        </p>
      </div>

      {success && (
        <SuccessBanner success={success} onDismiss={() => setSuccess(null)} onIssueInstead={issueInstead} />
      )}
      {notice && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{notice}</div>}

      <div role="tablist" aria-label="Return view" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'out' ? (
        <OutstandingOverview onReturn={openLine} onReturnAll={setBulk} refreshKey={refreshKey} />
      ) : (
        <ReturnByItem onReturn={openBalance} refreshKey={refreshKey} />
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title="Confirm return" size={kit ? 'md' : 'sm'}>
        {active && kit && (
          <KitReturnForm
            kit={active.item}
            balance={active.balance}
            onCancel={() => setActive(null)}
            onDone={(r) =>
              finish({ kind: 'kit', item: active.item.name, recipient: active.balance.recipient, ...r })
            }
          />
        )}
        {active && !kit && (
          <SimpleReturnForm
            item={active.item}
            balance={active.balance}
            onCancel={() => setActive(null)}
            onDone={(r) =>
              finish({
                kind: 'simple',
                item: active.item.name,
                recipient: active.balance.recipient,
                ...r,
                // a consumable coming back usually means they want something else instead
                exchange: r.consumable
                  ? { recipient: active.balance.recipient, department: active.balance.department }
                  : null,
              })
            }
          />
        )}
      </Modal>

      <ReturnAllModal
        group={bulk}
        onClose={() => setBulk(null)}
        onDone={(res, g) =>
          finish({ kind: 'batch', recipient: g.label, returned: res.returned, skipped: res.skipped })
        }
      />
    </div>
  )
}
