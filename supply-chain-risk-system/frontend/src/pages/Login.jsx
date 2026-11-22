import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button, ErrorBanner, Field, Input } from '../components/ui.jsx'
import { useAuth } from '../services/auth.jsx'
import AuthShell from './AuthShell.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email address.'
    if (!form.password) errs.password = 'Password is required.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true); setError('')
    try {
      await login(form.email.trim(), form.password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Sign in" subtitle="Access the supply chain risk dashboard"
      footer={<>No account yet? <Link to="/register" className="font-medium text-accent hover:underline">Create one</Link></>}>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email}>
          <Input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" />
        </Field>
        <Field label="Password" error={errors.password}>
          <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">Sign in</Button>
      </form>
    </AuthShell>
  )
}
