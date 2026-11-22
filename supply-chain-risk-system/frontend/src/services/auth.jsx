import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(!!getToken())

  useEffect(() => {
    if (!getToken()) return
    api('/api/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    const onExpired = () => setUser(null)
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await api('/api/auth/login', { method: 'POST', body: { email, password } })
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (data) => {
    const res = await api('/api/auth/register', { method: 'POST', body: data })
    setToken(res.access_token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* token may already be invalid */ }
    setToken(null)
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, checking, login, register, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
