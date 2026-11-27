import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirm, useToast } from '../components/feedback.jsx'
import { BasisTag, Button, Card, DetailList, ErrorBanner, Field, Input, Loading, Modal, PageHeader, ProbabilityBar, RiskBadge, Select, StatCard, StatusBadge, Table, Tabs } from '../components/ui.jsx'
import { api, fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtPct, todayISO } from '../services/api.js'
import { useApi } from '../services/useApi.js'

// ---------------------------------------------------------------- new customer (inline in the order form)
function CustomerForm({ opts, onSaved, onCancel }) {
  const [f, setF] = useState({ name: '', email: '', segment: opts.customer_segment[0], market: 'Europe', order_region: opts.region_by_market.Europe?.[0] || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => {
    const next = { ...f, [k]: e.target.value }
    if (k === 'market') next.order_region = opts.region_by_market[e.target.value]?.[0] || ''
    setF(next)
  }
  const save = async () => {
    if (f.name.trim().length < 2) { setError('Customer name is required.'); return }
    setBusy(true); setError('')
    try { onSaved(await api('/api/customers', { method: 'POST', body: { ...f, email: f.email.trim() || null } })) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <ErrorBanner message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer name"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="Email (optional)"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Segment"><Select value={f.segment} onChange={set('segment')} options={opts.customer_segment} /></Field>
        <Field label="Market"><Select value={f.market} onChange={set('market')} options={opts.market} /></Field>
        <Field label="Delivery region" hint="Market and region are inputs of the late-delivery model"><Select value={f.order_region} onChange={set('order_region')} options={opts.region_by_market[f.market] || []} /></Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={save} loading={busy}>Save customer</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- new order
function OrderForm({ onCreated, onCancel }) {
  const opts = useApi('/api/shipments/options')
  const customers = useApi('/api/customers')
  const products = useApi('/api/orders/available-products')
  const [f, setF] = useState({ customer_id: '', payment_type: 'DEBIT', shipping_mode: 'Standard Class', discount_rate: '0', notes: '' })
  const [lines, setLines] = useState([{ product_id: '', quantity: '1' }])
  const [newCustomer, setNewCustomer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const byId = useMemo(() => Object.fromEntries((products.data || []).map((p) => [String(p.product_id), p])), [products.data])

  if (opts.loading || customers.loading || products.loading) return <Loading />
  if (opts.error || customers.error || products.error) return <ErrorBanner message={opts.error || customers.error || products.error} />

  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  const disc = Number(f.discount_rate) || 0
  const total = lines.reduce((s, l) => s + (byId[l.product_id]?.price || 0) * (Number(l.quantity) || 0) * (1 - disc), 0)

  const submit = async (e) => {
    e.preventDefault()
    if (!f.customer_id) { setError('Select a customer.'); return }
    const items = lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) }))
    if (!items.length) { setError('Add at least one product.'); return }
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) { setError('Quantities must be whole numbers of at least 1.'); return }
    if (new Set(items.map((i) => i.product_id)).size !== items.length) { setError('Each product can appear only once - combine the quantities.'); return }
    const over = items.find((i) => i.quantity > byId[i.product_id].available)
    if (over) { setError(`Only ${byId[over.product_id].available} units of ${byId[over.product_id].name} are available.`); return }
    if (!(disc >= 0 && disc <= 0.9)) { setError('Discount must be between 0 and 0.9.'); return }
    setBusy(true); setError('')
    try {
      onCreated(await api('/api/orders', { method: 'POST', body: { ...f, customer_id: Number(f.customer_id), discount_rate: disc, notes: f.notes.trim() || null, items } }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const productOptions = (products.data || []).map((p) => ({ value: String(p.product_id), label: `${p.name} - ${fmtMoney(p.price)} (${p.available} available, ${p.warehouse})` }))
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">
          <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })} placeholder="Select a customer"
            options={(customers.data || []).map((c) => ({ value: String(c.id), label: `${c.name} (${c.market}, ${c.segment})` }))} />
        </Field>
        <div className="flex items-end">{!newCustomer && <Button type="button" variant="secondary" icon="plus" onClick={() => setNewCustomer(true)}>New customer</Button>}</div>
      </div>
      {newCustomer && <CustomerForm opts={opts.data} onCancel={() => setNewCustomer(false)}
        onSaved={(c) => { setNewCustomer(false); customers.reload(); setF({ ...f, customer_id: String(c.id) }) }} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Payment type"><Select value={f.payment_type} onChange={(e) => setF({ ...f, payment_type: e.target.value })} options={opts.data.payment_type} /></Field>
        <Field label="Shipping mode" hint={`Scheduled ${opts.data.scheduled_days_by_mode[f.shipping_mode]?.[0]} day(s)`}><Select value={f.shipping_mode} onChange={(e) => setF({ ...f, shipping_mode: e.target.value })} options={opts.data.shipping_mode} /></Field>
        <Field label="Discount rate (0-0.9)"><Input type="number" min="0" max="0.9" step="0.01" value={f.discount_rate} onChange={(e) => setF({ ...f, discount_rate: e.target.value })} /></Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-gray-700">Products</p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select value={l.product_id} onChange={(e) => setLine(i, 'product_id', e.target.value)} placeholder="Select a product" options={productOptions} className="min-w-0 flex-1" aria-label={`Product ${i + 1}`} />
              <Input type="number" min="1" step="1" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} className="w-24" aria-label={`Quantity ${i + 1}`} />
              <span className="w-24 text-right text-sm tabular-nums text-gray-600">{fmtMoney((byId[l.product_id]?.price || 0) * (Number(l.quantity) || 0) * (1 - disc))}</span>
              <Button type="button" variant="ghost" size="sm" icon="trash" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line" />
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" icon="plus" className="mt-2" onClick={() => setLines([...lines, { product_id: '', quantity: '1' }])}>Add product</Button>
      </div>
      <Field label="Notes (optional)"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} /></Field>
      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-600">Estimated total <b className="text-lg text-gray-900">{fmtMoney(total)}</b> <span className="text-xs">(calculated by the server from product prices)</span></p>
        <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Create order</Button></div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- order detail + workflow actions
const ACTION_LABEL = { Confirmed: 'Confirm & reserve stock', Processing: 'Start processing', 'Ready for Shipment': 'Mark ready for shipment', Shipped: 'Ship (dispatch stock)', Delivered: 'Record delivery', Cancelled: 'Cancel order' }
const ACTION_TEXT = {
  Confirmed: 'Stock will be reserved for every line and an outbound shipment will be created and scored by the late-delivery model.',
  Processing: 'The order moves to processing (picking and packing).',
  'Ready for Shipment': 'The order is packed and waiting for the carrier.',
  Shipped: 'Reserved stock will be dispatched (deducted from on-hand stock). This cannot be undone.',
  Cancelled: 'The order will be cancelled and any reserved stock released. This cannot be undone.',
}

function OrderDetail({ id, onChanged }) {
  const { data: o, loading, error, reload, setData } = useApi(`/api/orders/${id}`)
  const opts = useApi('/api/shipments/options')
  const confirm = useConfirm()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(todayISO())
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState('')
  useEffect(() => { if (o) setMode(o.shipping_mode) }, [o])

  if (loading && !o) return <Loading />
  if (error) return <ErrorBanner message={error} onRetry={reload} />

  const run = async (label, path, body) => {
    setBusy(label)
    try { const r = await api(path, { method: 'POST', body }); setData(r); onChanged(); return r } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }
  const transition = async (status) => {
    if (status === 'Cancelled' && reason.trim().length < 3) { toast('Enter a cancellation reason (at least 3 characters).', 'error'); return }
    if (status !== 'Delivered' && !(await confirm({ title: `${ACTION_LABEL[status]} - ${o.order_number}`, message: ACTION_TEXT[status], danger: status === 'Cancelled', confirmLabel: ACTION_LABEL[status] }))) return
    const r = await run(status, `/api/orders/${o.id}/status`, { status, note: status === 'Cancelled' ? reason.trim() : null, delivery_date: status === 'Delivered' ? deliveryDate : null })
    if (r) toast(`${r.order_number} is now ${r.status}.` + (status === 'Confirmed' && r.shipment ? ` Predicted late-delivery risk: ${r.shipment.risk_level} (${fmtPct(r.shipment.late_probability)}).` : ''))
  }
  const changeMode = async () => {
    const before = o.shipment?.late_probability ?? o.late_probability
    const r = await run('mode', `/api/orders/${o.id}/shipping-mode`, { shipping_mode: mode })
    if (r) toast(`Shipping mode changed to ${r.shipping_mode}. Late-delivery probability ${fmtPct(before)} -> ${fmtPct(r.shipment?.late_probability ?? r.late_probability)}.`)
  }
  const s = o.shipment
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3"><StatusBadge status={o.status} /><span className="text-sm text-gray-500">Created {fmtDateTime(o.created_at)}</span></div>
      <DetailList items={[['Customer', o.customer_name], ['Segment', o.customer_segment], ['Market / region', `${o.market} · ${o.order_region}`],
        ['Order date', fmtDateTime(o.order_date)], ['Payment', o.payment_type], ['Shipping mode', `${o.shipping_mode} (${o.scheduled_shipping_days} d scheduled)`],
        ['Discount', `${Math.round(o.discount_rate * 100)}%`], ['Total', fmtMoney(o.total_amount)], o.cancel_reason && ['Cancel reason', o.cancel_reason]]} />
      <Table rows={o.items} columns={[
        { key: 'product_name', label: 'Product', render: (i) => <div><p className="font-medium text-gray-900">{i.product_name}</p><p className="text-xs text-gray-500">{i.category}</p></div> },
        { key: 'quantity', label: 'Qty', align: 'right' },
        { key: 'unit_price', label: 'Unit price', align: 'right', render: (i) => fmtMoney(i.unit_price) },
        { key: 'line_total', label: 'Line total', align: 'right', render: (i) => fmtMoney(i.line_total) },
        { key: 'warehouse', label: 'Warehouse', render: (i) => i.warehouse || <span className="text-gray-400">on confirm</span> },
        { key: 'late_probability', label: 'Line late prob.', render: (i) => i.late_probability == null ? '-' : <ProbabilityBar value={i.late_probability} /> },
        ...(o.status === 'Delivered' ? [{ key: 'returned_quantity', label: 'Returned', align: 'right' }] : []),
      ]} />

      <div className="rounded-lg border border-gray-200 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold text-gray-900">Outbound shipment {s ? s.shipment_code : ''}</h4>
          {s && <StatusBadge status={s.status} />}<BasisTag kind="ml">ML prediction (DataCo Random Forest)</BasisTag>
        </div>
        {!s ? (
          <p className="text-sm text-gray-600">Created when the order is confirmed. Predicted late-delivery probability of the order now:{' '}
            <b>{fmtPct(o.late_probability)}</b> {o.risk_level && <RiskBadge level={o.risk_level} />}</p>
        ) : (
          <>
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <div><p className="text-xs text-gray-500">Late-delivery probability</p><div className="mt-1 flex flex-wrap items-center gap-2"><ProbabilityBar value={s.late_probability} /><RiskBadge level={s.risk_level} /></div></div>
              <div><p className="text-xs text-gray-500">Expected delivery</p><p className="font-medium">{fmtDate(s.expected_delivery_date)}</p></div>
              <div><p className="text-xs text-gray-500">Actual delivery</p><p className="font-medium">{fmtDate(s.actual_delivery_date)}</p></div>
              <div><p className="text-xs text-gray-500">Observed delay</p><p className={`font-medium ${s.is_delayed ? 'text-risk-high' : 'text-gray-900'}`}>{s.is_delayed ? `${s.days_late} day(s) late` : s.status === 'Delivered' ? 'On time' : 'None so far'}</p></div>
            </div>
            {s.recommendation && <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><b>Recommended action: </b>{s.recommendation}</p>}
            {s.events?.length > 0 && (
              <ol className="mt-3 space-y-1.5 border-l border-gray-200 pl-4 text-sm">
                {s.events.map((e, i) => <li key={i}><span className="text-xs text-gray-500">{fmtDateTime(e.created_at)}</span> <b className="text-gray-800">{e.status}</b> <span className="text-gray-600">{e.note}</span></li>)}
              </ol>
            )}
          </>
        )}
        {o.can_change_shipping_mode && opts.data && (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <Field label="Preventive action: change shipping mode and re-score"><Select value={mode} onChange={(e) => setMode(e.target.value)} options={opts.data.shipping_mode} className="w-48" /></Field>
            <Button variant="secondary" onClick={changeMode} loading={busy === 'mode'} disabled={mode === o.shipping_mode}>Apply & re-score</Button>
          </div>
        )}
      </div>

      {(o.allowed_transitions.length > 0 || o.status === 'Delivered') && (
        <div className="space-y-3 border-t border-gray-200 pt-4">
          {o.allowed_transitions.includes('Delivered') && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Actual delivery date"><Input type="date" value={deliveryDate} max={todayISO()} onChange={(e) => setDeliveryDate(e.target.value)} className="w-44" /></Field>
              <Button onClick={() => transition('Delivered')} loading={busy === 'Delivered'} icon="check">Record delivery</Button>
            </div>
          )}
          {o.allowed_transitions.includes('Cancelled') && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Cancellation reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-72" maxLength={300} placeholder="e.g. customer request" /></Field>
              <Button variant="danger" onClick={() => transition('Cancelled')} loading={busy === 'Cancelled'}>Cancel order</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {o.allowed_transitions.filter((t) => !['Delivered', 'Cancelled'].includes(t)).map((t) => (
              <Button key={t} onClick={() => transition(t)} loading={busy === t} icon="arrow">{ACTION_LABEL[t]}</Button>
            ))}
            {o.status === 'Delivered' && o.items.some((i) => i.returnable_quantity > 0) && (
              <Button variant="secondary" icon="returns" onClick={() => navigate(`/returns?order=${o.id}`)}>Register a return</Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- page
export default function Orders() {
  const [status, setStatus] = useState('')
  const list = useApi('/api/orders')
  const [modal, setModal] = useState(null) // {mode:'new'} | {mode:'view', id}
  const toast = useToast()
  const counts = list.data?.counts || {}
  const rows = (list.data?.items || []).filter((o) => !status || o.status === status)
  const open = ['Pending', 'Confirmed', 'Processing', 'Ready for Shipment', 'Shipped'].reduce((s, k) => s + (counts[k] || 0), 0)

  const columns = [
    { key: 'order_number', label: 'Order', render: (o) => <button className="font-medium text-accent hover:underline" onClick={() => setModal({ mode: 'view', id: o.id })}>{o.order_number}</button> },
    { key: 'order_date', label: 'Date', render: (o) => fmtDate(o.order_date) },
    { key: 'customer_name', label: 'Customer', render: (o) => <span className="block max-w-56 truncate" title={o.customer_name}>{o.customer_name}</span> },
    { key: 'units', label: 'Lines / units', align: 'right', render: (o) => `${o.item_count} / ${fmtNum(o.units)}` },
    { key: 'total_amount', label: 'Total', align: 'right', render: (o) => fmtMoney(o.total_amount) },
    { key: 'shipping_mode', label: 'Mode' },
    { key: 'late', label: 'Late-delivery risk', render: (o) => o.late_probability == null ? '-' : <div className="flex items-center gap-2"><ProbabilityBar value={o.shipment?.late_probability ?? o.late_probability} /><RiskBadge level={o.risk_level} /></div> },
    { key: 'expected', label: 'Expected delivery', render: (o) => o.shipment ? <span className={o.shipment.is_delayed ? 'font-medium text-risk-high' : ''}>{fmtDate(o.shipment.expected_delivery_date)}{o.shipment.is_delayed ? ` (+${o.shipment.days_late} d)` : ''}</span> : '-' },
    { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
  ]

  return (
    <div>
      <PageHeader title="Orders" description="Customer order management and fulfilment: availability check, stock reservation, ML late-delivery scoring, dispatch and delivery tracking."
        actions={<Button icon="plus" onClick={() => setModal({ mode: 'new' })}>New order</Button>} />
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total orders" value={list.data ? list.data.items.length : '-'} icon="orders" />
        <StatCard label="Open orders" value={list.data ? open : '-'} hint="Pending to Shipped" />
        <StatCard label="Stock reserved" value={list.data ? (counts.Confirmed || 0) + (counts.Processing || 0) + (counts['Ready for Shipment'] || 0) : '-'} hint="Confirmed, not yet shipped" />
        <StatCard label="Delayed orders" value={list.data ? list.data.delayed : '-'} tone={list.data?.delayed ? 'High' : 'Low'} hint="Past expected delivery date (observed)" />
      </div>
      <Card className="mt-6">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All', count: list.data?.items.length }, ...(list.data?.statuses || []).map((s) => ({ value: s, label: s, count: counts[s] }))]} />
        {list.loading && !list.data ? <Loading /> : <Table columns={columns} rows={rows} empty={status ? `No ${status.toLowerCase()} orders.` : 'No orders yet. Click "New order" to create the first customer order.'} />}
        <p className="mt-3 text-xs text-gray-500">Inventory policy: creating an order only checks availability; <b>Confirm</b> reserves stock; <b>Cancel</b> releases it; <b>Ship</b> deducts it from on-hand stock. Customers marked "Sample" are fictional records.</p>
      </Card>

      <Modal open={!!modal} wide onClose={() => setModal(null)} title={modal?.mode === 'new' ? 'New customer order' : 'Order details'}>
        {modal?.mode === 'new' && <OrderForm onCancel={() => setModal(null)} onCreated={(o) => { toast(`Order ${o.order_number} created (${fmtMoney(o.total_amount)}). Confirm it to reserve stock.`); list.reload(); setModal({ mode: 'view', id: o.id }) }} />}
        {modal?.mode === 'view' && <OrderDetail id={modal.id} onChanged={list.reload} />}
      </Modal>
    </div>
  )
}
