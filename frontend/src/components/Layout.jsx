import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  CalendarDays,
  Ruler,
  Calendar,
  LogOut,
  ArrowLeft,
  Home,
  Menu,
  X,
  Database,
  Settings,
  UserCircle,
  MapPin,
  FileDown,
  AlertTriangle,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'
import { useFaultSummary } from '../utils/faults'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inventory', icon: Package, label: 'Inventory' },
  { to: '/receive', icon: ArrowDownToLine, label: 'Receive Stock' },
  { to: '/issue', icon: ArrowUpFromLine, label: 'Issue Stock' },
  { to: '/daily-issues', icon: CalendarDays, label: 'Daily Issues' },
  { to: '/return', icon: RotateCcw, label: 'Return Stock' },
  { to: '/units', icon: Ruler, label: 'Units' },
  { to: '/events', icon: Calendar, label: 'Events' },
  { to: '/faults', icon: AlertTriangle, label: 'Faulty Items', badge: 'faults' },
  { to: '/exports', icon: FileDown, label: 'Reports & Exports' },
  { to: '/backups', icon: Database, label: 'Backups', adminOnly: true },
  { to: '/users', icon: Users, label: 'Users', adminOnly: true },
  { to: '/settings', icon: Settings, label: 'Settings', adminOnly: true },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { companyName, siteLocation, displayName } = useBranding()
  const faultSummary = useFaultSummary()
  const navigate = useNavigate()
  const location = useLocation()
  const isHome = location.pathname === '/'
  // 'default' key = first page loaded in this tab, so there is nothing to go back to
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/'))
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900 text-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-700 px-5">
          <Package className="h-7 w-7 shrink-0 text-primary-400" />
          <div className="min-w-0">
            <span className="block truncate text-lg font-semibold leading-tight tracking-tight" title={displayName}>
              {displayName}
            </span>
            {companyName && (
              <span className="block text-[11px] leading-tight text-slate-400">Inventory</span>
            )}
          </div>
          <button
            className="ml-auto rounded p-1 hover:bg-slate-800 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {navItems
            .filter((item) => !item.adminOnly || user?.role === 'admin')
            .map(({ to, icon: Icon, label, badge }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
                {badge === 'faults' && faultSummary.open > 0 && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${faultSummary.unusable > 0 ? 'bg-red-500 text-white' : 'bg-amber-400 text-slate-900'}`}>
                    {faultSummary.open}
                  </span>
                )}
              </NavLink>
            ))}
        </nav>

        <div className="border-t border-slate-700 p-4">
          {siteLocation && (
            <p className="mb-3 flex items-center gap-1.5 px-1 text-xs text-slate-400">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={siteLocation}>{siteLocation}</span>
            </p>
          )}
          <NavLink
            to="/profile"
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `mb-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-800 ${isActive ? 'bg-slate-800' : ''}`
            }
            title="Edit my profile"
          >
            <UserCircle className="h-8 w-8 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name}</p>
              <p className="truncate text-xs text-slate-400">
                @{user?.username} · <span className="capitalize">{user?.role}</span>
              </p>
            </div>
          </NavLink>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <button
            className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          {!isHome && (
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              title="Go back"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          )}
          <h1 className="hidden min-w-0 truncate text-sm font-medium text-slate-500 sm:block">
            {companyName ? companyName : 'Local Inventory Manager'}
            {siteLocation && <span className="font-normal text-slate-400"> · {siteLocation}</span>}
          </h1>
          {!isHome && (
            <button
              onClick={() => navigate('/')}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
              title="Dashboard"
            >
              <Home className="h-4 w-4" /> <span className="hidden sm:inline">Dashboard</span>
            </button>
          )}
        </header>
        {user?.defaultPassword && location.pathname !== '/profile' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:px-6">
            <span>
              <strong>Change your password.</strong> This account still uses the default password that anyone can look up.
            </span>
            <NavLink to="/profile" className="font-medium underline">Change it now</NavLink>
          </div>
        )}
        {user?.role === 'admin' && user?.recoveryCodesRemaining === 0 && location.pathname !== '/profile' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 lg:px-6">
            <span>
              <strong>Create your recovery codes.</strong> If you forget your admin password, they are the only way back in.
            </span>
            <NavLink to="/profile" className="font-medium underline">Create them now</NavLink>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
