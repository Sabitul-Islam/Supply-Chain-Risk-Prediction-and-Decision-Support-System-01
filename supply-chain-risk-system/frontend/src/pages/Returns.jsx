import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfirm, useToast } from '../components/feedback.jsx'
import { Button, Card, DetailList, ErrorBanner, Field, Input, Loading, Modal, PageHeader, Select, StatCard, StatusBadge, Table, Tabs } from '../components/ui.jsx'
import { api, fmtDateTime, fmtNum } from '../services/api.js'
import { useApi } from '../services/useApi.js'

function ReturnForm({ initialOrder, onCreated, onCancel }) {
  const orders = useApi('/api/returns/eligible-orders')
  const [orderId, setOrderId] = useState(initialOrder || '')
  const [qty, setQty] = useState({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (orders.loading) return <Loading />
  if (orders.error) return <ErrorBanner message={orders.error} />
  if (!orders.data.length) return <p className="text-sm text-gray-600">No delivered orders with returnable items. Returns can only be registered for orders with status <b>Delivered</b>.</p>
  const order = orders.data.find((o) => String(o.id) === String(orderId))

  const submit = async (e) => {
    e.preventDefault()
    if (!order) { setError('Select the original order.'); return }
    const items = order.lines.map((l) => ({ order_item_id: l.order_item_id, quantity: Number(qty[l.order_item_id] || 0) })).filter((i) => i.quantity !== 0)
    if (!items.length) { setError('Enter a return quantity for at least one product.'); return }
    const bad = items.find((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > order.lines.find((l) => l.order_item_id === i.order_item_id).returnable)
    if (bad) { setError('Return quantities must be whole numbers between 1 and the returnable quantity.'); return }
    if (reason.trim().length < 3) { setError('Enter a return reason (at least 3 characters).'); return }
    setBusy(true); setError('')
    try { onCreated(await api('/api/returns', { method: 'POST', body: { sales_order_id: order.id, reason: reason.trim(), items } })) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />
      <Field label="Original order"><Select value={String(orderId)} onChange={(e) => { setOrderId(e.target.value); setQty({}) }} placeholder="Select a delivered order"
        options={orders.data.map((o) => ({ value: String(o.id), label: `${o.order_number} - ${o.customer_name}` }))} /></Field>
      {order && (
        <Table rowKey="order_item_id" rows={order.lines} columns={[
          { key: 'product_name', label: 'Product' },
          { key: 'delivered', label: 'Delivered', align: 'right' },
          { key: 'returnable', label: 'Returnable', align: 'right' },
          { key: 'qty', label: 'Return qty', align: 'right', render: (l) => <Input type="number" min="0" max={l.returnable} value={qty[l.order_item_id] ?? ''} placeholder="0" onChange={(e) => setQty({ ...qty, [l.order_item_id]: e.target.value })} className="w-24 text-right" aria-label={`Return quantity ${l.product_name}`} /> },
        ]} />
      )}
      <Field label="Return reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. wrong size, damaged in transit" /></Field>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Register return</Button></div>
    </form>
  )
}

const NEXT_LABEL = { Approved: 'Approve', Received: 'Mark as received', Inspected: 'Record inspection', Restocked: 'Restock into inventory', Rejected: 'Reject' }

function ReturnDetail({ id, outcomes, onChanged }) {
  const { data: r, loading, error, reload, setData } = useApi(`/api/returns/${id}`)
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  if (loading && !r) return <Loading />
  if (error) return <ErrorBanner message={error} onRetry={reload} />

  const go = async (status) => {
    if (status === 'Inspected' && !outcome) { toast('Select an inspection outcome.', 'error'); return }
    const msg = status === 'Restocked' ? `Add ${r.units} unit(s) back to available stock?` : status === 'Rejected' ? 'Reject this return? This cannot be undone.' : `Change ${r.rma_number} to ${status}?`
    if (!(await confirm({ title: `${r.rma_number}: ${NEXT_LABEL[status]}`, message: msg, danger: status === 'Rejected', confirmLabel: NEXT_LABEL[status] }))) return
    setBusy(status)
    try {
      const res = await api(`/api/returns/${r.id}/status`, { method: 'POST', body: { status, inspection_outcome: status === 'Inspected' ? outcome : null, notes: notes.trim() || null } })
      setData(res); onChanged(); toast(`${res.rma_number} is now ${res.status}.` + (status === 'Restocked' ? ` ${res.restocked_units} unit(s) restocked.` : ''))
    } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }
  return (
    <div className="space-y-5">
      <StatusBadge status={r.status} />
      <DetailList items={[['Order', r.order_number], ['Customer', r.customer_name], ['Registered', fmtDateTime(r.created_at)], ['Reason', r.reason],
        ['Inspection outcome', r.inspection_outcome], ['Inspection notes', r.inspection_notes], ['Units / restocked', `${r.units} / ${r.restocked_units}`]]} />
      <Table rows={r.items} columns={[{ key: 'product_name', label: 'Product' }, { key: 'quantity', label: 'Qty', align: 'right' }, { key: 'warehouse', label: 'Restock to' }, { key: 'restocked_quantity', label: 'Restocked', align: 'right' }]} />
      {r.allowed_transitions.length > 0 ? (
        <div className="space-y-3 border-t border-gray-200 pt-4">
          {r.allowed_transitions.includes('Inspected') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Inspection outcome" hint="Only 'Restock' returns the units to stock"><Select value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Select outcome" options={outcomes} /></Field>
              <Field label="Inspection notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {r.allowed_transitions.map((t) => <Button key={t} variant={t === 'Rejected' ? 'danger' : 'primary'} loading={busy === t} onClick={() => go(t)}>{NEXT_LABEL[t]}</Button>)}
          </div>
        </div>
      ) : <p className="border-t border-gray-200 pt-4 text-sm text-gray-500">{r.status === 'Inspected' ? `Inspection outcome "${r.inspection_outcome}" - units are not returned to stock.` : `This return is ${r.status.toLowerCase()}.`}</p>}
    </div>
  )
}

export default function Returns() {
  const list = useApi('/api/returns')
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState('')
  const [modal, setModal] = useState(null)
  const toast = useToast()
  useEffect(() => { if (params.get('order')) setModal({ mode: 'new', order: params.get('order') }) }, [params])
  const c = list.data?.counts || {}
  const rows = (list.data?.items || []).filter((r) => !status || r.status === status)
  const close = () => { setModal(null); if (params.get('order')) setParams({}) }

  return (
    <div>
      <PageHeader title="Returns" description="Reverse logistics: register returns for delivered orders, approve, receive, inspect and restock approved items."
        actions={<Button icon="plus" onClick={() => setModal({ mode: 'new' })}>Register return</Button>} />
      <ErrorBanner message={list.error} onRetry={list.reload} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Awaiting approval" value={c.Requested ?? '-'} icon="returns" />
        <StatCard label="In progress" value={list.data ? (c.Approved || 0) + (c.Received || 0) : '-'} hint="Approved or received, not inspected" />
        <StatCard label="Restocked" value={c.Restocked ?? '-'} hint={list.data ? `${fmtNum(list.data.items.reduce((s, r) => s + r.restocked_units, 0))} units back in stock` : ''} />
        <StatCard label="Rejected / not restocked" value={list.data ? (c.Rejected || 0) + (c.Inspected || 0) : '-'} />
      </div>
      <Card className="mt-6">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All', count: list.data?.items.length }, ...(list.data?.statuses || []).map((s) => ({ value: s, label: s, count: c[s] }))]} />
        {list.loading && !list.data ? <Loading /> : <Table rows={rows} empty="No returns registered." columns={[
          { key: 'rma_number', label: 'Return', render: (r) => <button className="font-medium text-accent hover:underline" onClick={() => setModal({ mode: 'view', id: r.id })}>{r.rma_number}</button> },
          { key: 'order_number', label: 'Order' },
          { key: 'customer_name', label: 'Customer', render: (r) => <span className="block max-w-56 truncate">{r.customer_name}</span> },
          { key: 'units', label: 'Units', align: 'right' },
          { key: 'reason', label: 'Reason', wrap: true, render: (r) => <span className="block w-64 whitespace-normal text-xs">{r.reason}</span> },
          { key: 'inspection_outcome', label: 'Inspection', render: (r) => r.inspection_outcome || '-' },
          { key: 'created_at', label: 'Registered', render: (r) => fmtDateTime(r.created_at) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />}
      </Card>
      <Modal open={!!modal} wide onClose={close} title={modal?.mode === 'new' ? 'Register a product return' : 'Return details'}>
        {modal?.mode === 'new' && <ReturnForm initialOrder={modal.order} onCancel={close} onCreated={(r) => { toast(`Return ${r.rma_number} registered.`); list.reload(); setParams({}); setModal({ mode: 'view', id: r.id }) }} />}
        {modal?.mode === 'view' && <ReturnDetail id={modal.id} outcomes={list.data?.outcomes || []} onChanged={list.reload} />}
      </Modal>
    </div>
  )
}
