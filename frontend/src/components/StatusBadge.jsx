const styles = {
  upcoming: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-slate-100 text-slate-600',
  receive: 'bg-emerald-100 text-emerald-700',
  issue: 'bg-amber-100 text-amber-700',
  return: 'bg-sky-100 text-sky-700',
  low: 'bg-red-100 text-red-700',
  ok: 'bg-green-100 text-green-700',
  consumable: 'bg-orange-100 text-orange-700',
  reusable: 'bg-violet-100 text-violet-700',
  kit: 'bg-indigo-100 text-indigo-700',
  component: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
}

export default function StatusBadge({ status, children }) {
  return (
    <span className={`badge ${styles[status] || 'bg-slate-100 text-slate-600'}`}>
      {children || status}
    </span>
  )
}
