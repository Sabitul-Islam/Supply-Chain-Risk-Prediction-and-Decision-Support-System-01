import { useMemo, useState } from 'react'
import { useConfirm, useToast } from '../components/feedback.jsx'
import { BasisTag, Button, Card, DetailList, ErrorBanner, Field, Input, Loading, Modal, PageHeader, RiskBadge, Select, StatCard, StatusBadge, Table, Tabs } from '../components/ui.jsx'
import { api, fmtDate, fmtDateTime, fmtMoney, fmtNum, todayISO } from '../services/api.js'
import { useApi } from '../services/useApi.js'

// ---------------------------------------------------------------- reorder recommendations
function Recommendations({ onGenerated }) {
  const rec = useApi('/api/purchase-orders/recommendations')
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()
  const eligible = (rec.data || []).filter((p) => p.replenishment_qty > 0 && !p.draft_po_qty && p.recommended_supplier)
  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s) }

  const generate = async () => {
    const ids = selected.size ? [...selected] : eligible.map((p) => p.inventory_id)
    if (!ids.length) return
    if (!(await confirm({ title: 'Generate draft purchase orders', message: `Create draft purchase orders for ${ids.length} item(s)? Lines are grouped into one draft per recommended supplier and warehouse. Drafts still need approval.`, confirmLabel: 'Generate drafts' }))) return
    setBusy(true)
    try {
      const r = await api('/api/purchase-orders/generate', { method: 'POST', body: { inventory_ids: ids } })
      toast(`${r.created} draft purchase order(s) created.`)
      setSelected(new Set()); rec.reload(); onGenerated()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const columns = [
    { key: 'sel', label: '', render: (p) => <input type="checkbox" className="h-4 w-4 accent-[#2a78d6]" aria-label={`Select ${p.product_name}`} disabled={!eligible.includes(p)} checked={selected.has(p.inventory_id)} onChange={() => toggle(p.inventory_id)} /> },
    { key: 'product_name', label: 'Product / warehouse', render: (p) => <div><p className="max-w-60 truncate font-medium text-gray-900" title={p.product_name}>{p.product_name}</p><p className="text-xs text-gray-500">{p.warehouse} · {p.department}</p></div> },
    { key: 'stockout_risk', label: 'Stockout', render: (p) => <RiskBadge level={p.stockout_risk} /> },
    { key: 'net', label: 'Net / reorder', align: 'right', render: (p) => `${fmtNum(p.net_stock)} / ${fmtNum(p.reorder_level)}` },
    { key: 'cover', label: 'Cover / lead (d)', align: 'right', render: (p) => `${fmtNum(p.days_of_cover, 1)} / ${p.lead_time_days}` },
    { key: 'rate', label: 'Demand/day hist. → forecast', align: 'right', render: (p) => <span title={p.forecast_method || 'No forecast (short history)'}>{fmtNum(p.historical_daily, 1)} → {p.forecast_daily == null ? 'n/a' : fmtNum(p.forecast_daily, 1)}</span> },
    { key: 'on_order', label: 'On order', align: 'right', render: (p) => fmtNum(p.on_order) + (p.draft_po_qty ? ` (+${p.draft_po_qty} draft)` : '') },
    { key: 'replenishment_qty', label: 'Order qty', align: 'right', render: (p) => <b className="text-gray-900">{fmtNum(p.replenishment_qty)}</b> },
    { key: 'supplier', label: 'Recommended supplier', wrap: true, render: (p) => p.recommended_supplier ? (
      <div className="min-w-48">
        <p className="flex items-center gap-1.5 font-medium text-gray-900">{p.recommended_supplier.name}<RiskBadge level={p.recommended_supplier.risk_level} /></p>
        <p className="text-xs text-gray-500">score {p.recommended_supplier.selection_score} · lead {p.recommended_supplier.avg_lead_time_days} d{p.alternative_suppliers.length ? ` · alt: ${p.alternative_suppliers.map((a) => a.name).join(', ')}` : ''}</p>
        {p.recommended_supplier.warnings.length > 0 && <p className="text-xs text-[#b54708]">{p.recommended_supplier.warnings.join('; ')}</p>}
      </div>) : <span className="text-xs text-gray-400">-</span> },
    { key: 'action', label: 'Action', wrap: true, render: (p) => <span className="block w-56 whitespace-normal text-xs text-gray-600">{p.action}</span> },
  ]

  return (
    <Card title="Reorder recommendations" subtitle="Inventory → demand forecast → replenishment quantity → supplier comparison → draft purchase order"
      actions={<><BasisTag kind="rule">Rule-based</BasisTag><BasisTag kind="forecast">Statistical forecast</BasisTag>
        <Button icon="plus" onClick={generate} loading={busy} disabled={!eligible.length}>{selected.size ? `Generate drafts (${selected.size})` : `Generate drafts for all (${eligible.length})`}</Button></>}>
      <ErrorBanner message={rec.error} onRetry={rec.reload} />
      {rec.loading && !rec.data ? <Loading /> : <Table rowKey="inventory_id" columns={columns} rows={rec.data} maxHeight={460} empty="No item is at or below its reorder level - no replenishment needed." />}
      <details className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-700">How the recommendation is calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Planning demand/day</b> = max(historical average from DataCo orders, next-month exponential-smoothing forecast ÷ 30.4).</li>
          <li><b>Order qty</b> = reorder level + planning demand × 30-day review period − (net stock + quantity already on approved/ordered POs).</li>
          <li><b>Supplier selection score</b> = 0.7 × (100 − supplier risk score) + 0.3 × lead-time score (100 × shortest lead time ÷ supplier lead time). Candidates are suppliers of the product's department; High-risk suppliers are ranked last.</li>
          <li>Supplier performance values and stock quantities are simulated sample data.</li>
        </ul>
      </details>
    </Card>
  )
}

// ---------------------------------------------------------------- manual PO
function POForm({ onCreated, onCancel }) {
  const suppliers = useApi('/api/suppliers')
  const products = useApi('/api/products')
  const inv = useApi('/api/inventory/warehouses')
  const [f, setF] = useState({ supplier_id: '', warehouse: 'Central DC', expected_arrival_date: '', notes: '' })
  const [lines, setLines] = useState([{ product_id: '', quantity: '', unit_cost: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (suppliers.loading || products.loading) return <Loading />
  const warehouses = [...new Set([...(inv.data || []).map((w) => w.warehouse), 'Central DC'])]
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const sup = (suppliers.data || []).find((s) => String(s.id) === f.supplier_id)

  const submit = async (e) => {
    e.preventDefault()
    if (!f.supplier_id) { setError('Select a supplier.'); return }
    const items = lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), unit_cost: l.unit_cost === '' ? null : Number(l.unit_cost) }))
    if (!items.length) { setError('Add at least one product.'); return }
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) { setError('Quantities must be whole numbers of at least 1.'); return }
    if (items.some((i) => i.unit_cost != null && !(i.unit_cost >= 0))) { setError('Unit cost must be 0 or more.'); return }
    setBusy(true); setError('')
    try {
      onCreated(await api('/api/purchase-orders', { method: 'POST', body: { supplier_id: Number(f.supplier_id), warehouse: f.warehouse, expected_arrival_date: f.expected_arrival_date || null, notes: f.notes.trim() || null, items } }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier" hint={sup ? `Risk ${sup.risk_level} (${sup.risk_score}) · lead time ${sup.avg_lead_time_days} d` : undefined}>
          <Select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })} placeholder="Select a supplier"
            options={(suppliers.data || []).map((s) => ({ value: String(s.id), label: `${s.name} - ${s.category} (${s.risk_level} risk)` }))} />
        </Field>
        <Field label="Deliver to warehouse"><Select value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })} options={warehouses} /></Field>
        <Field label="Expected arrival (optional)" hint="Default: order date + supplier lead time"><Input type="date" min={todayISO()} value={f.expected_arrival_date} onChange={(e) => setF({ ...f, expected_arrival_date: e.target.value })} /></Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Lines</p>
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)} placeholder="Select a product" aria-label={`Product ${i + 1}`} className="min-w-0 flex-1"
              options={(products.data || []).map((p) => ({ value: String(p.id), label: `${p.name} (${p.department})` }))} />
            <Input type="number" min="1" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className="w-24" aria-label={`Quantity ${i + 1}`} />
            <Input type="number" min="0" step="0.01" placeholder="Unit cost" value={l.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} className="w-28" aria-label={`Unit cost ${i + 1}`} />
            <Button type="button" variant="ghost" size="sm" icon="trash" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line" />
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => setLines([...lines, { product_id: '', quantity: '', unit_cost: '' }])}>Add line</Button>
        <p className="text-xs text-gray-500">Unit cost is optional (the datasets contain no purchase costs); the PO value is shown only when every line has a cost.</p>
      </div>
      <Field label="Notes (optional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={1000} /></Field>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Create draft PO</Button></div>
    </form>
  )
}

// ---------------------------------------------------------------- PO detail
function PODetail({ id, onChanged }) {
  const { data: po, loading, error, reload, setData } = useApi(`/api/purchase-orders/${id}`)
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [expected, setExpected] = useState('')
  const [arrival, setArrival] = useState(todayISO())
  const [received, setReceived] = useState({})
  if (loading && !po) return <Loading />
  if (error) return <ErrorBanner message={error} onRetry={reload} />

  const post = async (label, path, body, msg) => {
    setBusy(label)
    try { const r = await api(path, { method: 'POST', body }); setData(r); onChanged(); toast(msg(r)) } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }
  const status = async (s) => {
    const text = { Approved: 'Approve this purchase order?', Ordered: 'Send this purchase order to the supplier? The expected arrival date will be set.', Cancelled: 'Cancel this purchase order? This cannot be undone.' }[s]
    if (!(await confirm({ title: `${po.po_number}: ${s}`, message: text, danger: s === 'Cancelled', confirmLabel: s === 'Ordered' ? 'Mark as ordered' : s === 'Cancelled' ? 'Cancel PO' : 'Approve' }))) return
    post(s, `/api/purchase-orders/${po.id}/status`, { status: s, expected_arrival_date: s === 'Ordered' && expected ? expected : null }, (r) => `${r.po_number} is now ${r.status}.` + (s === 'Ordered' ? ` Expected arrival ${fmtDate(r.expected_arrival_date)}.` : ''))
  }
  const receive = async () => {
    const items = po.items.map((i) => ({ item_id: i.id, received_quantity: received[i.id] === undefined || received[i.id] === '' ? i.quantity : Number(received[i.id]) }))
    if (items.some((i, k) => !Number.isInteger(i.received_quantity) || i.received_quantity < 0 || i.received_quantity > po.items[k].quantity)) { toast('Received quantities must be whole numbers between 0 and the ordered quantity.', 'error'); return }
    if (!(await confirm({ title: `Receive ${po.po_number}`, message: `Add ${items.reduce((s, i) => s + i.received_quantity, 0)} units to stock in ${po.warehouse} with arrival date ${arrival}? A purchase order can be received only once.`, confirmLabel: 'Receive into stock' }))) return
    post('receive', `/api/purchase-orders/${po.id}/receive`, { actual_arrival_date: arrival, items }, (r) => `${r.po_number} received: ${r.received_units} units added to stock.` + (r.is_delayed ? ` Delivery was ${r.days_late} day(s) late.` : ''))
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={po.status} />{po.source === 'reorder_recommendation' && <BasisTag kind="rule">Generated from reorder recommendation</BasisTag>}
        {po.is_delayed && <span className="text-sm font-medium text-risk-high">Inbound delivery {po.days_late} day(s) late</span>}</div>
      <DetailList items={[['Supplier', `${po.supplier_name} (${po.supplier_code})`], ['Supplier risk', <RiskBadge key="r" level={po.supplier_risk_level} />], ['Warehouse', po.warehouse],
        ['Created', fmtDateTime(po.created_at)], ['Approved', fmtDateTime(po.approved_at)], ['Ordered', fmtDateTime(po.ordered_at)],
        ['Expected arrival', fmtDate(po.expected_arrival_date)], ['Actual arrival', fmtDate(po.actual_arrival_date)], ['Value', po.total_amount == null ? 'unit costs not entered' : fmtMoney(po.total_amount)]]} />
      {po.notes && <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{po.notes}</p>}
      <Table rows={po.items} columns={[
        { key: 'product_name', label: 'Product', render: (i) => <span className="font-medium text-gray-900">{i.product_name}</span> },
        { key: 'quantity', label: 'Ordered', align: 'right', render: (i) => fmtNum(i.quantity) },
        { key: 'received_quantity', label: 'Received', align: 'right', render: (i) => po.status === 'Ordered'
          ? <Input type="number" min="0" max={i.quantity} value={received[i.id] ?? i.quantity} onChange={(e) => setReceived({ ...received, [i.id]: e.target.value })} className="w-24 text-right" aria-label={`Received ${i.product_name}`} />
          : fmtNum(i.received_quantity) },
        { key: 'unit_cost', label: 'Unit cost', align: 'right', render: (i) => (i.unit_cost == null ? '-' : fmtMoney(i.unit_cost)) },
      ]} />
      <div className="flex flex-wrap items-end gap-2 border-t border-gray-200 pt-4">
        {po.allowed_transitions.includes('Approved') && <Button onClick={() => status('Approved')} loading={busy === 'Approved'} icon="check">Approve</Button>}
        {po.allowed_transitions.includes('Ordered') && <>
          <Field label="Expected arrival (optional)"><Input type="date" min={todayISO()} value={expected} onChange={(e) => setExpected(e.target.value)} className="w-44" /></Field>
          <Button onClick={() => status('Ordered')} loading={busy === 'Ordered'} icon="arrow">Mark as ordered</Button></>}
        {po.status === 'Ordered' && <>
          <Field label="Actual arrival date"><Input type="date" max={todayISO()} value={arrival} onChange={(e) => setArrival(e.target.value)} className="w-44" /></Field>
          <Button onClick={receive} loading={busy === 'receive'} icon="inventory">Receive into stock</Button></>}
        {po.allowed_transitions.includes('Cancelled') && <Button variant="danger" onClick={() => status('Cancelled')} loading={busy === 'Cancelled'}>Cancel PO</Button>}
        {!po.allowed_transitions.length && <p className="text-sm text-gray-500">This purchase order is {po.status.toLowerCase()} - no further actions.</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export default function PurchaseOrders() {
  const list = useApi('/api/purchase-orders')
  const [status, setStatus] = useState('')
  const [modal, setModal] = useState(null)
  const [recKey, setRecKey] = useState(0)
  const toast = useToast()
  const c = list.data?.counts || {}
  const rows = useMemo(() => (list.data?.items || []).filter((p) => !status || p.status === status), [list.data, status])
  const refresh = () => { list.reload(); setRecKey((k) => k + 1) }

  const columns = [
    { key: 'po_number', label: 'PO', render: (p) => <button className="font-medium text-accent hover:underline" onClick={() => setModal({ mode: 'view', id: p.id })}>{p.po_number}</button> },
    { key: 'supplier_name', label: 'Supplier', render: (p) => <div className="flex items-center gap-2"><span className="max-w-48 truncate">{p.supplier_name}</span><RiskBadge level={p.supplier_risk_level} /></div> },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'units', label: 'Lines / units', align: 'right', render: (p) => `${p.line_count} / ${fmtNum(p.units)}` },
    { key: 'received_units', label: 'Received', align: 'right', render: (p) => (p.status === 'Received' ? fmtNum(p.received_units) : '-') },
    { key: 'expected_arrival_date', label: 'Expected', render: (p) => fmtDate(p.expected_arrival_date) },
    { key: 'actual_arrival_date', label: 'Arrived', render: (p) => fmtDate(p.actual_arrival_date) },
    { key: 'delay', label: 'Inbound delay', render: (p) => (p.is_delayed ? <span className="font-medium text-risk-high">{p.days_late} d late</span> : p.status === 'Received' ? 'On time' : '-') },
    { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    { key: 'source', label: 'Source', render: (p) => <span className="text-xs text-gray-500">{p.source === 'reorder_recommendation' ? 'Recommendation' : 'Manual'}</span> },
  ]
  return (
    <div>
      <PageHeader title="Purchase Orders" description="Replenishment from reorder recommendations, supplier selection, approval workflow and inbound delivery tracking."
        actions={<Button icon="plus" onClick={() => setModal({ mode: 'new' })}>New purchase order</Button>} />
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Drafts" value={c.Draft ?? '-'} hint="Need approval" />
        <StatCard label="Approved" value={c.Approved ?? '-'} hint="Not yet sent" />
        <StatCard label="Awaiting receipt" value={c.Ordered ?? '-'} icon="transportation" hint="Inbound, ordered" />
        <StatCard label="Inbound delayed" value={list.data?.inbound_delayed ?? '-'} tone={list.data?.inbound_delayed ? 'High' : 'Low'} hint="Past expected arrival (observed)" />
        <StatCard label="Received" value={c.Received ?? '-'} />
      </div>
      <div className="mt-6"><Recommendations key={recKey} onGenerated={list.reload} /></div>
      <Card className="mt-6" title="Purchase orders">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All', count: list.data?.items.length }, ...(list.data?.statuses || []).map((s) => ({ value: s, label: s, count: c[s] }))]} />
        {list.loading && !list.data ? <Loading /> : <Table columns={columns} rows={rows} empty="No purchase orders. Generate drafts from the recommendations above or create one manually." />}
      </Card>
      <Modal open={!!modal} wide onClose={() => setModal(null)} title={modal?.mode === 'new' ? 'New purchase order' : 'Purchase order'}>
        {modal?.mode === 'new' && <POForm onCancel={() => setModal(null)} onCreated={(p) => { toast(`Draft ${p.po_number} created.`); refresh(); setModal({ mode: 'view', id: p.id }) }} />}
        {modal?.mode === 'view' && <PODetail id={modal.id} onChanged={refresh} />}
      </Modal>
    </div>
  )
}
