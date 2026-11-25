import { useState } from 'react'
import { Building2, MapPin, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'

export default function SettingsPage() {
  const { user } = useAuth()
  const branding = useBranding()
  const [companyName, setCompanyName] = useState(branding.companyName)
  const [siteLocation, setSiteLocation] = useState(branding.siteLocation)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  if (user?.role !== 'admin') {
    return (
      <div className="card mx-auto max-w-xl p-6 text-sm text-slate-600">
        Only administrators can change company settings.
      </div>
    )
  }

  const dirty =
    companyName.trim() !== branding.companyName || siteLocation.trim() !== branding.siteLocation

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setSaving(true)
    try {
      const saved = await branding.save({ companyName, siteLocation })
      setCompanyName(saved.companyName)
      setSiteLocation(saved.siteLocation)
      setMessage('Saved. The new name and location now appear across the app and on exports.')
    } catch (err) {
      setError(err.message || 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h2 className="mb-1 text-xl font-semibold text-slate-800">Company settings</h2>
      <p className="mb-6 text-sm text-slate-500">
        Shown on the sign-in page, sidebar, page header, browser tab and on CSV / PDF exports.
      </p>

      <form onSubmit={submit} className="card space-y-5 p-5">
        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {message}
          </div>
        )}

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Building2 className="h-4 w-4 text-slate-400" /> Company name
          </label>
          <input
            className="input"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Acme Events Ltd"
          />
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <MapPin className="h-4 w-4 text-slate-400" /> Site location
          </label>
          <input
            className="input"
            value={siteLocation}
            onChange={(e) => setSiteLocation(e.target.value)}
            maxLength={200}
            placeholder="e.g. Main Store, Nairobi"
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave a field empty to remove it. Once you work with sites, each site's own name (see Sites) is shown in
            the header and on exports instead of this line.
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
