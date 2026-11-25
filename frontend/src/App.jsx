import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import InventoryList from './pages/InventoryList'
import ItemDetail from './pages/ItemDetail'
import ReceiveStock from './pages/ReceiveStock'
import IssueStock from './pages/IssueStock'
import DailyIssues from './pages/DailyIssues'
import ReturnStock from './pages/ReturnStock'
import UnitsPage from './pages/UnitsPage'
import EventsPage from './pages/EventsPage'
import EventDetail from './pages/EventDetail'
import BackupPage from './pages/BackupPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'
import ExportsPage from './pages/ExportsPage'
import FaultsPage from './pages/FaultsPage'
import ActivityPage from './pages/ActivityPage'
import UsersPage from './pages/UsersPage'
import SitesPage from './pages/SitesPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  // An admin-issued temporary password has to be replaced before anything else (the server enforces this too)
  if (user.mustChangePassword && location.pathname !== '/profile') return <Navigate to="/profile" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<InventoryList />} />
        <Route path="inventory/:id" element={<ItemDetail />} />
        <Route path="receive" element={<ReceiveStock />} />
        <Route path="issue" element={<IssueStock />} />
        <Route path="daily-issues" element={<DailyIssues />} />
        <Route path="return" element={<ReturnStock />} />
        <Route path="units" element={<UnitsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="faults" element={<FaultsPage />} />
        <Route path="exports" element={<ExportsPage />} />
        <Route path="backups" element={<BackupPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
