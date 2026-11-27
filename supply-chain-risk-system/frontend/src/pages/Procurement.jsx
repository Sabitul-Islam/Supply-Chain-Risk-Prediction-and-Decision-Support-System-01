import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import CsvUpload from '../components/CsvUpload.jsx'
import { ChartTooltip, RiskBarChart, SERIES, axisProps } from '../components/charts.jsx'
import { Link } from 'react-router-dom'
import { useConfirm } from '../components/feedback.jsx'
import { BasisTag, Button, Card, ErrorBanner, Field, Input, Loading, Modal, PageHeader, RiskBadge, Select, StatusBadge, SuccessBanner, Table } from '../components/ui.jsx'
import { api, fmtDate, fmtNum } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const EMPTY = { supplier_code: '', name: '', country: '', category: '', on_time_delivery_rate: '', defect_rate: '',
  avg_lead_time_days: '', lead_time_variability_days: '', fulfillment_rate: '', financial_stability: '3' }
const NUMERIC = ['on_time_delivery_rate', 'defect_rate', 'avg_lead_time_days', 'lead_time_variability_days', 'fulfillment_rate', 'financial_stability']
const FACTOR_LABELS = { delivery: 'Delivery', quality: 'Quality', lead_time: 'Lead-time var.', fulfillment: 'Fulfilment', financial: 'Financial' }

function SupplierForm({ initial, onSaved, onCancel }) {
  const [form, setForm] = useState(initial ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, String(initial[k])])) : EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const missing = Object.keys(EMPTY).filter((k) => String(form[k]).trim() === '')
    if (missing.length) { setError('Please fill in all fields.'); return }
    const body = { ...form }
    NUMERIC.forEach((k) => { body[k] = Number(form[k]) })
    if (NUMERIC.some((k) => Number.isNaN(body[k]))) { setError('Numeric fields must contain numbers.'); return }
    setBusy(true); setError('')
    try {
      const saved = initial ? await api(`/api/suppliers/${initial.id}`, { method: 'PUT', body }) : await api('/api/suppliers', { method: 'POST', body })
      onSaved(saved)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier code"><Input value={form.supplier_code} onChange={set('supplier_code')} placeholder="SUP-021" /></Field>
        <Field label="Name"><Input value={form.name} onChange={set('name')} /></Field>
        <Field label="Country"><Input value={form.country} onChange={set('country')} /></Field>
        <Field label="Category / department"><Input value={form.category} onChange={set('category')} /></Field>
        <Field label="On-time delivery rate (%)"><Input type="number" step="0.1" min="0" max="100" value={form.on_time_delivery_rate} onChange={set('on_time_delivery_rate')} /></Field>
        <Field label="Defect rate (%)"><Input type="number" step="0.01" min="0" max="100" value={form.defect_rate} onChange={set('defect_rate')} /></Field>
        <Field label="Average lead time (days)"><Input type="number" step="0.1" min="0.1" value={form.avg_lead_time_days} onChange={set('avg_lead_time_days')} /></Field>
        <Field label="Lead time variability (± days)"><Input type="number" step="0.1" min="0" value={form.lead_time_variability_days} onChange={set('lead_time_variability_days')} /></Field>
        <Field label="Fulfilment rate (%)"><Input type="number" step="0.1" min="0" max="100" value={form.fulfillment_rate} onChange={set('fulfillment_rate')} /></Field>
        <Field label="Financial stability (1 weak - 5 strong)"><Select value={form.financial_stability} onChange={set('financial_stability')} options={['1', '2', '3', '4', '5']} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>{initial ? 'Save changes' : 'Add supplier'}</Button>
      </div>
    </form>
  )
}

function SupplierLinks({ id }) {
  const d = useApi(`/api/suppliers/${id}`)
  if (d.loading) return <Loading />
  if (d.error) return <ErrorBanner message={d.error} />
  const o = d.data.observed_inbound
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 font-medium text-gray-700">Associated products ({d.data.products.length})</p>
        <Table rows={d.data.products} maxHeight={220} empty="No products are linked to this supplier." columns={[
          { key: 'name', label: 'Product', render: (p) => <span className="block max-w-64 truncate">{p.name}</span> },
          { key: 'category', label: 'Category' },
          { key: 'stock', label: 'Stock (net) / risk', render: (p) => p.stock.length ? p.stock.map((x) => <span key={x.warehouse} className="mr-2 inline-flex items-center gap-1">{x.warehouse}: {fmtNum(x.net_stock)} <RiskBadge level={x.stockout_risk} /></span>) : <span className="text-gray-400">not stocked</span> },
        ]} />
      </div>
      <div>
        <p className="mb-2 font-medium text-gray-700">Purchase orders ({d.data.purchase_orders.length}) <span className="ml-2 font-normal text-gray-500">Observed inbound on-time rate: {o.on_time_rate == null ? 'no received POs yet' : `${o.on_time_rate}% of ${o.received_orders} received`}</span> <BasisTag kind="observed">Observed</BasisTag></p>
        <Table rows={d.data.purchase_orders} maxHeight={200} empty="No purchase orders with this supplier." columns={[
          { key: 'po_number', label: 'PO' }, { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          { key: 'units', label: 'Units', align: 'right' }, { key: 'expected_arrival_date', label: 'Expected', render: (p) => fmtDate(p.expected_arrival_date) },
          { key: 'actual_arrival_date', label: 'Arrived', render: (p) => fmtDate(p.actual_arrival_date) },
          { key: 'is_delayed', label: 'Delay', render: (p) => (p.is_delayed ? <span className="text-risk-high">{p.days_late} d</span> : '-') },
        ]} />
      </div>
    </div>
  )
}

function SupplierDetail({ s }) {
  const data = Object.entries(s.breakdown).map(([k, v]) => ({ factor: FACTOR_LABELS[k], score: v }))
  return (
    <div className="space-y-4 text-sm">
      <BasisTag kind="rule">Rule-based assessment - not a trained ML model</BasisTag>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums text-gray-900">{s.risk_score}</span>
        <span className="text-gray-500">/ 100 risk score</span><RiskBadge level={s.risk_level} />
      </div>
      <p className="rounded-lg bg-gray-50 p-3 text-gray-700">{s.recommendation}</p>
      <div>
        <p className="mb-2 font-medium text-gray-700">Factor sub-scores (0 = best, 100 = worst)</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 20, bottom: 0 }}>
            <XAxis type="number" domain={[0, 100]} {...axisProps} />
            <YAxis type="category" dataKey="factor" {...axisProps} width={90} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
            <Bar isAnimationActive={false} dataKey="score" name="Sub-score" fill={SERIES.primary} radius={[0, 4, 4, 0]} barSize={16}>
              <LabelList dataKey="score" position="right" fill="#374151" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-gray-600">
        <dt>On-time delivery</dt><dd className="text-right font-medium text-gray-900">{s.on_time_delivery_rate}%</dd>
        <dt>Defect rate</dt><dd className="text-right font-medium text-gray-900">{s.defect_rate}%</dd>
        <dt>Lead time</dt><dd className="text-right font-medium text-gray-900">{s.avg_lead_time_days} ± {s.lead_time_variability_days} days</dd>
        <dt>Fulfilment rate</dt><dd className="text-right font-medium text-gray-900">{s.fulfillment_rate}%</dd>
        <dt>Financial stability</dt><dd className="text-right font-medium text-gray-900">{s.financial_stability} / 5</dd>
        <dt>Linked products</dt><dd className="text-right font-medium text-gray-900">{s.product_count}</dd>
      </dl>
      <SupplierLinks id={s.id} />
    </div>
  )
}

export default function Procurement() {
  const { data, loading, error, reload } = useApi('/api/suppliers')
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null) // {mode:'add'|'edit'|'view', supplier}
  const [msg, setMsg] = useState('')
  const [actionError, setActionError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const confirm = useConfirm()

  const rows = useMemo(() => (data || []).filter((s) => (!filter || s.risk_level === filter) &&
    (!search || `${s.name} ${s.supplier_code} ${s.country} ${s.category}`.toLowerCase().includes(search.toLowerCase()))), [data, filter, search])
  const dist = ['Low', 'Medium', 'High'].map((level) => ({ level, count: (data || []).filter((s) => s.risk_level === level).length }))

  const remove = async (s) => {
    if (!(await confirm({ title: 'Delete supplier', message: `Delete supplier ${s.name}? Linked products keep their records but lose this supplier. Suppliers with purchase orders cannot be deleted.`, danger: true, confirmLabel: 'Delete' }))) return
    setDeleting(s.id); setActionError('')
    try { await api(`/api/suppliers/${s.id}`, { method: 'DELETE' }); setMsg(`Supplier ${s.name} deleted.`); reload() } catch (e) { setActionError(e.message) } finally { setDeleting(null) }
  }

  const columns = [
    { key: 'supplier_code', label: 'Code' },
    { key: 'name', label: 'Supplier', render: (s) => <button className="font-medium text-accent hover:underline" onClick={() => setModal({ mode: 'view', supplier: s })}>{s.name}</button> },
    { key: 'country', label: 'Country' },
    { key: 'category', label: 'Category' },
    { key: 'on_time_delivery_rate', label: 'On-time %', align: 'right' },
    { key: 'defect_rate', label: 'Defect %', align: 'right' },
    { key: 'lead', label: 'Lead time (d)', align: 'right', render: (s) => `${s.avg_lead_time_days} ± ${s.lead_time_variability_days}` },
    { key: 'fulfillment_rate', label: 'Fulfil %', align: 'right' },
    { key: 'financial_stability', label: 'Fin. (1-5)', align: 'right' },
    { key: 'risk_score', label: 'Score', align: 'right', render: (s) => <span className="font-semibold text-gray-900">{s.risk_score}</span> },
    { key: 'risk_level', label: 'Risk', render: (s) => <RiskBadge level={s.risk_level} /> },
    { key: 'actions', label: '', render: (s) => (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setModal({ mode: 'edit', supplier: s })} aria-label="Edit" />
        <Button size="sm" variant="ghost" icon="trash" loading={deleting === s.id} onClick={() => remove(s)} aria-label="Delete" />
      </div>) },
  ]

  return (
    <div>
      <PageHeader title="Procurement - Suppliers" description="Supplier records, performance indicators, rule-based supplier risk scoring, associated products and purchase-order history."
        actions={<><Link to="/purchase-orders"><Button variant="secondary" icon="purchase">Purchase orders & recommendations</Button></Link><Button icon="plus" onClick={() => setModal({ mode: 'add' })}>Add supplier</Button></>} />
      <SuccessBanner message={msg} onClose={() => setMsg('')} />
      <ErrorBanner message={actionError || error} onRetry={error ? reload : undefined} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Supplier risk distribution"><RiskBarChart data={dist} name="Suppliers" /></Card>
        <Card title="How the risk score is calculated" className="lg:col-span-2">
          <div className="grid gap-4 text-sm text-gray-600 sm:grid-cols-2">
            <ul className="space-y-1.5">
              <li><b className="text-gray-800">Delivery (30%)</b> = (100 − on-time %) × 2.5</li>
              <li><b className="text-gray-800">Quality (25%)</b> = defect % × 12.5</li>
              <li><b className="text-gray-800">Lead-time variability (15%)</b> = variability ÷ lead time × 200</li>
              <li><b className="text-gray-800">Fulfilment (15%)</b> = (100 − fulfilment %) × 4</li>
              <li><b className="text-gray-800">Financial (15%)</b> = (5 − rating) ÷ 4 × 100</li>
            </ul>
            <div className="space-y-2">
              <p>Each factor is capped to 0-100 and the weighted sum gives the score (higher = riskier).</p>
              <div className="flex flex-wrap gap-2"><RiskBadge level="Low" /><span>&lt; 35</span><RiskBadge level="Medium" /><span>35-60</span><RiskBadge level="High" /><span>≥ 60</span></div>
              <p className="text-xs text-gray-500">Note: supplier records are sample data (no supplier file was provided). Upload your own CSV to replace or extend them.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6" title="Suppliers" subtitle={data ? `${rows.length} of ${data.length} suppliers, sorted by risk` : ''}
        actions={<>
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="All risk levels" options={['High', 'Medium', 'Low']} className="w-40" />
        </>}>
        {loading && !data ? <Loading /> : <Table columns={columns} rows={rows} empty="No suppliers match the filter." />}
      </Card>

      <Card className="mt-6" title="Upload suppliers (CSV)" subtitle="Rows with an existing supplier_code are updated; new codes are added. Invalid rows are reported and skipped.">
        <CsvUpload uploadPath="/api/suppliers/upload" templatePath="/api/suppliers/template" templateName="suppliers_template.csv"
          onDone={() => reload()} />
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} wide
        title={modal?.mode === 'add' ? 'Add supplier' : modal?.mode === 'edit' ? `Edit ${modal.supplier.name}` : modal?.supplier?.name}>
        {modal?.mode === 'view' ? <SupplierDetail s={modal.supplier} /> : modal && (
          <SupplierForm initial={modal.supplier} onCancel={() => setModal(null)}
            onSaved={(s) => { setModal(null); setMsg(`Supplier ${s.name} saved - risk score ${s.risk_score} (${s.risk_level}).`); reload() }} />
        )}
      </Modal>
    </div>
  )
}
