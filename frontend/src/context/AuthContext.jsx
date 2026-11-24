import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../utils/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('inventory_token')
    const stored = localStorage.getItem('inventory_user')
    if (token && stored) {
      try {
        setUser(JSON.parse(stored))
        // Validate token in background
        api
          .me()
          .then((data) => {
            // pick up name/username changes made elsewhere
            localStorage.setItem('inventory_user', JSON.stringify(data.user))
            setUser(data.user)
          })
          .catch((err) => {
            // Only a rejected login means the session is over. A network blip or the server
            // restarting (502/503/timeout) used to sign everybody out and lose what they were doing.
            if (err?.status === 401) {
              localStorage.removeItem('inventory_token')
              localStorage.removeItem('inventory_user')
              setUser(null)
            }
          })
      } catch {
        localStorage.removeItem('inventory_token')
        localStorage.removeItem('inventory_user')
      }
    }
    setLoading(false)
  }, [])

  const login = async (username, password) => {
    try {
      const data = await api.login(username, password)
      localStorage.setItem('inventory_token', data.token)
      localStorage.setItem('inventory_user', JSON.stringify(data.user))
      setUser(data.user)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message || 'Login failed' }
    }
  }

  // Used after a profile edit: the server returns a fresh token and user
  const updateSession = (token, nextUser) => {
    if (token) localStorage.setItem('inventory_token', token)
    localStorage.setItem('inventory_user', JSON.stringify(nextUser))
    setUser(nextUser)
  }

  // Re-read the account (e.g. after making recovery codes, so the reminder banner updates)
  const refreshUser = async () => {
    try {
      const data = await api.me()
      localStorage.setItem('inventory_user', JSON.stringify(data.user))
      setUser(data.user)
    } catch {
      /* the next page load will pick it up */
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('inventory_token')
    localStorage.removeItem('inventory_user')
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, updateSession, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
