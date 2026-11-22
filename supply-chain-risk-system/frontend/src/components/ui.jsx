import { cloneElement, isValidElement, useEffect, useId } from 'react'
import Icon from './icons.jsx'

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

const TONES = {
  default: 'text-gray-900',
  High: 'text-risk-high',
  Medium: 'text-[#c2410c]',
  Low: 'text-[#067a06]',
}

export function StatCard({ label, value, hint, tone = 'default', icon }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {icon && <span className="text-gray-400"><Icon name={icon} className="h-4 w-4" /></span>}
      </div>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${TONES[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

const BADGE = {
  High: 'bg-red-50 text-[#b42318] border-red-200',
  Medium: 'bg-orange-50 text-[#b54708] border-orange-200',
  Low: 'bg-green-50 text-[#067647] border-green-200',
}
const DOT = { High: 'bg-risk-high', Medium: 'bg-risk-medium', Low: 'bg-risk-low' }

// Risk colour always comes with a text label + dot so meaning never depends on colour alone.
export function RiskBadge({ level }) {
  if (!level) return <span className="text-xs text-gray-400">n/a</span>
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE[level]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[level]}`} />{level}
    </span>
  )
}

export function Spinner({ className = 'h-5 w-5' }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-gray-200 border-t-accent ${className}`} role="status" aria-label="Loading" />
}

export function Loading({ label = 'Loading...' }) {
  return <div className="flex items-center justify-center gap-3 py-12 text-sm text-gray-500"><Spinner />{label}</div>
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && <button onClick={onRetry} className="font-medium underline">Retry</button>}
    </div>
  )
}

export function SuccessBanner({ message, onClose }) {
  if (!message) return null
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
      <span className="flex-1">{message}</span>
      {onClose && <button onClick={onClose} aria-label="Dismiss"><Icon name="close" className="h-4 w-4" /></button>}
    </div>
  )
}

const BTN = {
  primary: 'bg-accent text-white hover:bg-accent-dark border-transparent',
  secondary: 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300',
  danger: 'bg-white text-red-700 hover:bg-red-50 border-red-200',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 border-transparent',
}

export function Button({ variant = 'primary', loading, icon, children, className = '', size = 'md', ...props }) {
  const sz = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
  return (
    <button {...props} disabled={loading || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sz} ${BTN[variant]} ${className}`}>
      {loading ? <Spinner className="h-4 w-4" /> : icon && <Icon name={icon} className="h-4 w-4" />}
      {children}
    </button>
  )
}

const inputBase = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

export function Field({ label, error, hint, children }) {
  const id = useId()
  const descId = `${id}-desc`
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': hint || error ? descId : undefined })
    : children
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {control}
      {hint && !error && <p id={descId} className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p id={descId} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// Full width unless the caller supplies its own width class.
const inputCls = (extra = '') => `${inputBase} ${/(^|\s)w-/.test(extra) ? '' : 'w-full'} ${extra}`

export function Input(props) {
  return <input {...props} className={inputCls(props.className)} />
}

export function Select({ options, placeholder, ...props }) {
  return (
    <select {...props} className={inputCls(props.className)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const value = typeof o === 'object' ? o.value : o
        const label = typeof o === 'object' ? o.label : o
        return <option key={value} value={value}>{label}</option>
      })}
    </select>
  )
}

export function Modal({ open, title, onClose, children, wide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/30 p-4 pt-16" onMouseDown={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl border border-gray-200 bg-white shadow-xl`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Empty({ children }) {
  return <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-500">{children}</div>
}

export function Table({ columns, rows, rowKey = 'id', empty = 'No records found.', maxHeight }) {
  if (!rows?.length) return <Empty>{empty}</Empty>
  return (
    <div className="overflow-auto rounded-lg border border-gray-200" style={maxHeight ? { maxHeight } : undefined}>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="sticky top-0 bg-gray-50">
          <tr>{columns.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} className="hover:bg-gray-50">
              {columns.map((c) => <td key={c.key} className={`px-3 py-2.5 text-gray-700 ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.wrap ? '' : 'whitespace-nowrap'}`}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
      <span>{total.toLocaleString()} records · page {page} of {pages}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  )
}

export function ProbabilityBar({ value }) {
  const pct = Math.round((value || 0) * 100)
  const color = value >= 0.5 ? 'bg-risk-high' : value >= 0.2 ? 'bg-risk-medium' : 'bg-risk-low'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-gray-100"><div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <span className="tabular-nums text-gray-700">{pct}%</span>
    </div>
  )
}
