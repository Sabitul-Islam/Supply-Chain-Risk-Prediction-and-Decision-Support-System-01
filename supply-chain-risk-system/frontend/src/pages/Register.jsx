import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button, ErrorBanner, Field, Input } from '../components/ui.jsx'
import { useAuth } from '../services/auth.jsx'
import AuthShell from './AuthShell.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateRegistration(f) {
  const e = {}
  if (f.full_name.trim().length < 2) e.full_name = 'Enter your full name (at least 2 characters).'
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address.'
  if (f.password.length < 8) e.password = 'Password must be at least 8 characters.'
  else if (f.password.length > 64) e.password = 'Password must be at most 64 characters.'
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'Password must contain a letter and a number.'
  if (f.confirm_password !== f.password) e.confirm_password = 'Passwords do not match.'
  return e
}

export default function Register() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm_password: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/" replace />
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const errs = validateRegistration(form)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true); setError('')
    try {
      await register({ ...form, full_name: form.full_name.trim(), email: form.email.trim() })
      navigate('/', { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Create account" subtitle="Register to use the decision support system"
      footer={<>Already registered? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link></>}>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Full name" error={errors.full_name}><Input autoComplete="name" value={form.full_name} onChange={set('full_name')} /></Field>
        <Field label="Email" error={errors.email}><Input type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@example.com" /></Field>
        <Field label="Password" error={errors.password} hint="8-64 characters, at least one letter and one number.">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Confirm password" error={errors.confirm_password}>
          <Input type="password" autoComplete="new-password" value={form.confirm_password} onChange={set('confirm_password')} />
        </Field>
        <Button type="submit" loading={busy} className="w-full">Create account</Button>
      </form>
    </AuthShell>
  )
}
