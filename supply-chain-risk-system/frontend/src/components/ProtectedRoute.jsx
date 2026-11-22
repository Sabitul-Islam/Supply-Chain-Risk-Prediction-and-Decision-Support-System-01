import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../services/auth.jsx'
import { Loading } from './ui.jsx'

export default function ProtectedRoute({ children }) {
  const { user, checking } = useAuth()
  const location = useLocation()
  if (checking) return <Loading label="Checking session..." />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}
