import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import CsvUpload from '../components/CsvUpload.jsx'
import { ChartTooltip, RiskBarChart, SERIES, axisProps, gridProps } from '../components/charts.jsx'
import { Button, Card, ErrorBanner, Field, Input, Loading, Modal, PageHeader, RiskBadge, Select, StatCard, SuccessBanner, Table } from '../components/ui.jsx'
import { api, fmtNum } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const FIELDS = ['product_id', 'warehouse', 'available_stock', 'reserved_stock', 'reorder_level', 'safety_stock', 'lead_time_days', 'avg_daily_demand']
const EMPTY = Object.fromEntries(FIELDS.map((k) => [k, '']))

function InventoryForm({ initial, products, onSaved, onCancel }) {
  const [form, setForm] = useState(initial ? Object.fromEntries(FIELDS.map((k) => [k, String(initial[k])])) : { ...EMPTY, warehouse: 'Central DC' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (FIELDS.some((k) => String(form[k]).trim() === '')) { setError('Please fill in all fields.'); return }
    const body = { ...form }
    FIELDS.filter((k) => k !== 'warehouse').forEach((k) => { body[k] = Number(form[k]) })
    if (body.reserved_stock > body.available_stock) { setError('Reserved stock cannot exceed available stock.'); return }
    setBusy(true); setError('')
    try {
      const saved = initial ? await api(`/api/inventory/${initial.id}`, { method: 'PUT', body }) : await api('/api/inventory', { method: 'POST', body })
      onSaved(saved)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Product"><Select value={form.product_id} onChange={set('product_id')} placeholder="Select a product" options={products.map((p) => ({ value: String(p.id), label: `${p.name} (#${p.id})` }))} /></Field>
        </div>
        <Field label="Warehouse"><Input value={form.warehouse} onChange={set('warehouse')} /></Field>
        <Field label="Lead time (days)"><Input type="number" min="1" value={form.lead_time_days} onChange={set('lead_time_days')} /></Field>
        <Field label="Available stock"><Input type="number" min="0" value={form.available_stock} onChange={set('available_stock')} /></Field>
        <Field label="Reserved stock"><Input type="number" min="0" value={form.reserved_stock} onChange={set('reserved_stock')} /></Field>
        <Field label="Reorder level" hint="avg daily demand × lead time + safety stock"><Input type="number" min="0" value={form.reorder_level} onChange={set('reorder_level')} /></Field>
        <Field label="Safety stock" hint="1.65 × σ daily demand × √lead time"><Input type="number" min="0" value={form.safety_stock} onChange={set('safety_stock')} /></Field>
        <Field label="Average daily demand (units)"><Input type="number" min="0" step="0.01" value={form.avg_daily_demand} onChange={set('avg_daily_demand')} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>{initial ? 'Save changes' : 'Add record'}</Button>
      </div>
    </form>
  )
}

export default function Inventory() {
  const inv = useApi('/api/inventory')
  const products = useApi('/api/products')
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [deleting, setDeleting] = useState(null)

  const data = inv.data || []
  const rows = useMemo(() => data.filter((i) => (!filter || i.stockout_risk === filter) &&
    (!search || `${i.product_name} ${i.category} ${i.warehouse}`.toLowerCase().includes(search.toLowerCase()))), [data, filter, search])
  const dist = ['Low', 'Medium', 'High'].map((level) => ({ level, count: data.filter((i) => i.stockout_risk === level).length }))
  const alerts = data.filter((i) => i.stockout_risk !== 'Low')
  const chartData = alerts.slice(0, 10).map((i) => ({ name: i.product_name.length > 22 ? `${i.product_name.slice(0, 22)}…` : i.product_name, 'Net stock': i.net_stock, 'Reorder level': i.reorder_level }))

  const remove = async (i) => {
    if (!window.confirm(`Delete inventory record for ${i.product_name}?`)) return
    setDeleting(i.id)
    try { await api(`/api/inventory/${i.id}`, { method: 'DELETE' }); setMsg('Inventory record deleted.'); inv.reload() } catch (e) { setErr(e.message) } finally { setDeleting(null) }
  }

  const columns = [
    { key: 'product_name', label: 'Product', render: (i) => <div><p className="font-medium text-gray-900">{i.product_name}</p><p className="text-xs text-gray-500">#{i.product_id} · {i.category}</p></div> },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'available_stock', label: 'Available', align: 'right', render: (i) => fmtNum(i.available_stock) },
    { key: 'reserved_stock', label: 'Reserved', align: 'right', render: (i) => fmtNum(i.reserved_stock) },
    { key: 'net_stock', label: 'Net', align: 'right', render: (i) => <span className="font-medium text-gray-900">{fmtNum(i.net_stock)}</span> },
    { key: 'safety_stock', label: 'Safety', align: 'right', render: (i) => fmtNum(i.safety_stock) },
    { key: 'reorder_level', label: 'Reorder lvl', align: 'right', render: (i) => fmtNum(i.reorder_level) },
    { key: 'avg_daily_demand', label: 'Daily demand', align: 'right', render: (i) => fmtNum(i.avg_daily_demand, 1) },
    { key: 'days_of_cover', label: 'Cover (d)', align: 'right', render: (i) => `${fmtNum(i.days_of_cover, 1)} / ${i.lead_time_days}` },
    { key: 'stockout_risk', label: 'Stockout risk', render: (i) => <RiskBadge level={i.stockout_risk} /> },
    { key: 'recommended_order_qty', label: 'Order qty', align: 'right', render: (i) => i.recommended_order_qty ? <span className="font-semibold text-gray-900">{fmtNum(i.recommended_order_qty)}</span> : '-' },
    { key: 'actions', label: '', render: (i) => (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setModal({ item: i })} title="Edit" />
        <Button size="sm" variant="ghost" icon="trash" loading={deleting === i.id} onClick={() => remove(i)} title="Delete" />
      </div>) },
  ]

  return (
    <div>
      <PageHeader title="Inventory" description="Stock positions, safety stock, reorder levels and rule-based stockout risk with reorder recommendations."
        actions={<Button icon="plus" onClick={() => setModal({})} disabled={!products.data}>Add record</Button>} />
      <SuccessBanner message={msg} onClose={() => setMsg('')} />
      <ErrorBanner message={err || inv.error} onRetry={inv.error ? inv.reload : undefined} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Inventory records" value={data.length} />
        <StatCard label="High stockout risk" value={dist[2].count} tone={dist[2].count ? 'High' : 'Low'} />
        <StatCard label="Need reorder" value={alerts.length} tone={alerts.length ? 'Medium' : 'Low'} />
        <StatCard label="Units to order" value={fmtNum(alerts.reduce((s, i) => s + i.recommended_order_qty, 0))} hint="Sum of recommended order quantities" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Stockout risk distribution"><RiskBarChart data={dist} name="Items" /></Card>
        <Card title="Items needing reorder: net stock vs reorder level" className="lg:col-span-2">
          {chartData.length === 0 ? <p className="text-sm text-gray-500">No items need reordering.</p> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 28, bottom: 0 }} barGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} tick={{ fill: '#6b7280', fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis {...axisProps} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#374151' }} verticalAlign="top" align="right" />
                <Bar isAnimationActive={false} dataKey="Net stock" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar isAnimationActive={false} dataKey="Reorder level" fill="#a3a3a0" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="mt-6" title="Inventory records" subtitle="Sorted by stockout risk"
        actions={<>
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="All risk levels" options={['High', 'Medium', 'Low']} className="w-40" />
        </>}>
        {inv.loading && !inv.data ? <Loading /> : <Table columns={columns} rows={rows} maxHeight={560} />}
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <b>Rules:</b> Net = available − reserved. <b>High</b>: net ≤ safety stock or days of cover &lt; lead time. <b>Medium</b>: net ≤ reorder level. <b>Low</b>: otherwise.
          Order qty = reorder level + 30 days of demand − net. Average daily demand and its variability come from real DataCo orders; stock quantities are sample data.
        </div>
      </Card>

      <Card className="mt-6" title="Upload inventory (CSV)" subtitle="Existing product + warehouse combinations are updated; product_id must exist in the product catalogue.">
        <CsvUpload uploadPath="/api/inventory/upload" templatePath="/api/inventory/template" templateName="inventory_template.csv" onDone={() => inv.reload()} />
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} wide title={modal?.item ? `Edit ${modal.item.product_name}` : 'Add inventory record'}>
        {modal && <InventoryForm initial={modal.item} products={products.data || []} onCancel={() => setModal(null)}
          onSaved={(s) => { setModal(null); setMsg(`Saved ${s.product_name}: stockout risk ${s.stockout_risk}. ${s.recommendation}`); inv.reload() }} />}
      </Modal>
    </div>
  )
}
