import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import CsvUpload from '../components/CsvUpload.jsx'
import { ChartTooltip, RiskBarChart, SERIES, axisProps, gridProps } from '../components/charts.jsx'
import { useConfirm, useToast } from '../components/feedback.jsx'
import { Button, Card, ErrorBanner, Field, Input, Loading, Modal, PageHeader, RiskBadge, Select, StatCard, SuccessBanner, Table, Tabs } from '../components/ui.jsx'
import { api, fmtDateTime, fmtNum } from '../services/api.js'
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

// Manual stock correction (stock count, damage, loss). Recorded as an ADJUSTED movement.
function AdjustForm({ item, onSaved, onCancel }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    const q = Number(qty)
    if (!Number.isInteger(q) || q === 0) { setError('Enter a whole number other than 0 (negative to remove stock).'); return }
    if (item.available_stock + q < item.reserved_stock) { setError(`On-hand stock cannot fall below reserved stock (${item.reserved_stock}).`); return }
    if (reason.trim().length < 3) { setError('Enter a reason (at least 3 characters).'); return }
    setBusy(true); setError('')
    try { onSaved(await api(`/api/inventory/${item.id}/adjust`, { method: 'POST', body: { quantity_change: q, reason: reason.trim() } })) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <p className="text-sm text-gray-600">On hand <b>{fmtNum(item.available_stock)}</b>, reserved <b>{fmtNum(item.reserved_stock)}</b> in {item.warehouse}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Quantity change" hint="e.g. 25 or -10"><Input type="number" step="1" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. cycle count correction" /></Field>
      </div>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Record adjustment</Button></div>
    </form>
  )
}

const TXN_TYPES = ['RECEIVED', 'RESERVED', 'RELEASED', 'DISPATCHED', 'RETURNED', 'ADJUSTED']
const signed = (n) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? fmtNum(n) : '0')

function Movements({ inventoryId, onClear }) {
  const [type, setType] = useState('')
  const q = new URLSearchParams({ limit: '300', ...(type && { txn_type: type }), ...(inventoryId && { inventory_id: String(inventoryId) }) })
  const t = useApi(`/api/inventory/transactions?${q}`)
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} placeholder="All movement types" options={TXN_TYPES} className="w-52" />
        {inventoryId && <Button variant="secondary" size="sm" onClick={onClear}>Show all records</Button>}
        <Button variant="ghost" size="sm" icon="refresh" onClick={t.reload}>Refresh</Button>
      </div>
      <ErrorBanner message={t.error} onRetry={t.reload} />
      {t.loading && !t.data ? <Loading /> : <Table rows={t.data} maxHeight={480} empty="No stock movements recorded yet. Movements are created by orders, purchase-order receipts, returns and adjustments." columns={[
        { key: 'created_at', label: 'When', render: (x) => fmtDateTime(x.created_at) },
        { key: 'txn_type', label: 'Type', render: (x) => <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">{x.txn_type}</span> },
        { key: 'product_name', label: 'Product', render: (x) => <span className="block max-w-56 truncate">{x.product_name || `#${x.product_id}`}</span> },
        { key: 'warehouse', label: 'Warehouse' },
        { key: 'available_change', label: 'On hand Δ', align: 'right', render: (x) => signed(x.available_change) },
        { key: 'reserved_change', label: 'Reserved Δ', align: 'right', render: (x) => signed(x.reserved_change) },
        { key: 'after', label: 'After (on hand / reserved)', align: 'right', render: (x) => `${fmtNum(x.available_after)} / ${fmtNum(x.reserved_after)}` },
        { key: 'reference_label', label: 'Reference', render: (x) => x.reference_label || '-' },
        { key: 'note', label: 'Note', wrap: true, render: (x) => <span className="block w-56 whitespace-normal text-xs text-gray-600">{x.note || ''}</span> },
      ]} />}
    </>
  )
}

function Warehouses() {
  const w = useApi('/api/inventory/warehouses')
  if (w.loading && !w.data) return <Loading />
  return <Table rowKey="warehouse" rows={w.data} columns={[
    { key: 'warehouse', label: 'Warehouse', render: (x) => <b className="text-gray-900">{x.warehouse}</b> },
    { key: 'records', label: 'Products', align: 'right' },
    { key: 'available_stock', label: 'On hand', align: 'right', render: (x) => fmtNum(x.available_stock) },
    { key: 'reserved_stock', label: 'Reserved', align: 'right', render: (x) => fmtNum(x.reserved_stock) },
    { key: 'net_stock', label: 'Net available', align: 'right', render: (x) => fmtNum(x.net_stock) },
    { key: 'on_order', label: 'On order (POs)', align: 'right', render: (x) => fmtNum(x.on_order) },
    { key: 'High', label: 'High risk', align: 'right', render: (x) => <span className={x.High ? 'font-semibold text-risk-high' : ''}>{x.High}</span> },
    { key: 'Medium', label: 'Medium risk', align: 'right' },
    { key: 'Low', label: 'Low risk', align: 'right' },
  ]} />
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
  const [tab, setTab] = useState('records')
  const [moveFor, setMoveFor] = useState(null)
  const confirm = useConfirm()
  const toast = useToast()

  const data = inv.data || []
  const rows = useMemo(() => data.filter((i) => (!filter || i.stockout_risk === filter) &&
    (!search || `${i.product_name} ${i.category} ${i.warehouse}`.toLowerCase().includes(search.toLowerCase()))), [data, filter, search])
  const dist = ['Low', 'Medium', 'High'].map((level) => ({ level, count: data.filter((i) => i.stockout_risk === level).length }))
  const alerts = data.filter((i) => i.stockout_risk !== 'Low')
  const chartData = alerts.slice(0, 10).map((i) => ({ name: i.product_name.length > 22 ? `${i.product_name.slice(0, 22)}…` : i.product_name, 'Net stock': i.net_stock, 'Reorder level': i.reorder_level }))

  const remove = async (i) => {
    if (!(await confirm({ title: 'Delete inventory record', message: `Delete the stock record for ${i.product_name} in ${i.warehouse}? Its movement history is kept.`, danger: true, confirmLabel: 'Delete' }))) return
    setDeleting(i.id)
    try { await api(`/api/inventory/${i.id}`, { method: 'DELETE' }); toast('Inventory record deleted.'); inv.reload() } catch (e) { setErr(e.message) } finally { setDeleting(null) }
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
    { key: 'on_order', label: 'On order', align: 'right', render: (i) => i.on_order ? fmtNum(i.on_order) : i.draft_po_qty ? <span className="text-xs text-gray-500">{fmtNum(i.draft_po_qty)} draft</span> : '-' },
    { key: 'stockout_risk', label: 'Stockout risk', render: (i) => <RiskBadge level={i.stockout_risk} /> },
    { key: 'recommended_order_qty', label: 'Order qty', align: 'right', render: (i) => i.recommended_order_qty ? <span className="font-semibold text-gray-900">{fmtNum(i.recommended_order_qty)}</span> : '-' },
    { key: 'actions', label: '', render: (i) => (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setModal({ adjust: i })} title="Adjust stock" aria-label="Adjust stock" />
        <Button size="sm" variant="ghost" icon="history" onClick={() => { setMoveFor(i.id); setTab('movements') }} title="Stock movements" aria-label="Stock movements" />
        <Button size="sm" variant="ghost" icon="edit" onClick={() => setModal({ item: i })} title="Edit" />
        <Button size="sm" variant="ghost" icon="trash" loading={deleting === i.id} onClick={() => remove(i)} title="Delete" />
      </div>) },
  ]

  return (
    <div>
      <PageHeader title="Inventory" description="Product- and warehouse-level stock positions, reservations, purchase orders on order, rule-based stockout risk and the full stock movement history."
        actions={<><Link to="/purchase-orders"><Button variant="secondary" icon="purchase">Reorder recommendations</Button></Link><Button icon="plus" onClick={() => setModal({})} disabled={!products.data}>Add record</Button></>} />
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

      <Card className="mt-6">
        <Tabs value={tab} onChange={(t) => { setTab(t); if (t !== 'movements') setMoveFor(null) }} tabs={[{ value: 'records', label: 'Product stock', count: data.length }, { value: 'warehouses', label: 'Warehouses' }, { value: 'movements', label: 'Stock movements' }]} />
        {tab === 'warehouses' && <Warehouses />}
        {tab === 'movements' && <Movements inventoryId={moveFor} onClear={() => setMoveFor(null)} />}
        {tab === 'records' && <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-500">Sorted by stockout risk</p>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="All risk levels" options={['High', 'Medium', 'Low']} className="w-40" />
          </div>
        </div>
        {inv.loading && !inv.data ? <Loading /> : <Table columns={columns} rows={rows} maxHeight={560} />}
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <b>Rules:</b> Net = available − reserved. <b>High</b>: net ≤ safety stock or days of cover &lt; lead time. <b>Medium</b>: net ≤ reorder level. <b>Low</b>: otherwise.
          Order qty = reorder level + 30 days of demand − net. Average daily demand and its variability come from real DataCo orders; stock quantities are sample data.
          On order = approved / ordered purchase-order quantity not yet received. Stock changes from orders, receipts, returns and adjustments are logged in <b>Stock movements</b>.
        </div>
        </>}
      </Card>

      <Card className="mt-6" title="Upload inventory (CSV)" subtitle="Existing product + warehouse combinations are updated; product_id must exist in the product catalogue.">
        <CsvUpload uploadPath="/api/inventory/upload" templatePath="/api/inventory/template" templateName="inventory_template.csv" onDone={() => inv.reload()} />
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} wide={!modal?.adjust} title={modal?.adjust ? `Adjust stock - ${modal.adjust.product_name}` : modal?.item ? `Edit ${modal.item.product_name}` : 'Add inventory record'}>
        {modal?.adjust && <AdjustForm item={modal.adjust} onCancel={() => setModal(null)} onSaved={(r) => { setModal(null); toast(`Stock adjusted: ${r.product_name} now ${r.available_stock} on hand (${r.stockout_risk} stockout risk).`); inv.reload() }} />}
        {modal && !modal.adjust && <InventoryForm initial={modal.item} products={products.data || []} onCancel={() => setModal(null)}
          onSaved={(s) => { setModal(null); setMsg(`Saved ${s.product_name}: stockout risk ${s.stockout_risk}. ${s.recommendation}`); inv.reload() }} />}
      </Modal>
    </div>
  )
}
