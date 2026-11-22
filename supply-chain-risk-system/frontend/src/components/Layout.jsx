import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../services/auth.jsx'
import Icon from './icons.jsx'

const NAV = [
  { to: '/', label: 'Overview', icon: 'overview' },
  { to: '/procurement', label: 'Procurement', icon: 'procurement' },
  { to: '/production', label: 'Production', icon: 'production' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory' },
  { to: '/transportation', label: 'Transportation', icon: 'transportation' },
  { to: '/demand', label: 'Demand Analysis', icon: 'demand' },
  { to: '/assistant', label: 'AI Assistant', icon: 'assistant' },
  { to: '/history', label: 'Prediction History', icon: 'history' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const doLogout = async () => {
    setLoggingOut(true)
    await logout()
    navigate('/login', { replace: true })
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"><Icon name="demand" className="h-4 w-4" /></div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-gray-900">SupplyRisk</p>
          <p className="text-xs text-gray-500">Decision Support</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-accent-light text-accent-dark' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
              <Icon name={n.icon} className="h-[18px] w-[18px]" />{n.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-200 p-3">
        <div className="mb-2 px-3 text-xs text-gray-500">
          <p className="truncate font-medium text-gray-800">{user?.full_name}</p>
          <p className="truncate">{user?.email}</p>
        </div>
        <button onClick={doLogout} disabled={loggingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-60">
          <Icon name="logout" className="h-[18px] w-[18px]" />{loggingOut ? 'Logging out...' : 'Logout'}
        </button>
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-gray-200 bg-gray-50/60 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-gray-900/20" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-gray-200 bg-white">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1.5 text-gray-600 hover:bg-gray-100" aria-label="Open menu"><Icon name="menu" /></button>
          <span className="text-sm font-semibold">SupplyRisk</span>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><Outlet /></main>
      </div>
    </div>
  )
}
