import { useEffect, useState } from 'react'
import CsvUpload from '../components/CsvUpload.jsx'
import ModelMetrics from '../components/ModelMetrics.jsx'
import PredictionResult from '../components/PredictionResult.jsx'
import { RiskBarChart } from '../components/charts.jsx'
import { Link } from 'react-router-dom'
import { BasisTag, Button, Card, ErrorBanner, Field, Input, Loading, PageHeader, Pagination, ProbabilityBar, RiskBadge, Select, StatCard, StatusBadge, Table, Tabs } from '../components/ui.jsx'
import { api, fmtDate, fmtNum, fmtPct } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const now = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

function PredictForm({ opts, onPredicted }) {
  const [form, setForm] = useState({
    order_id: '', order_date: now(), payment_type: 'DEBIT', shipping_mode: 'Standard Class', scheduled_shipping_days: '4',
    market: 'Europe', order_region: 'Western Europe', department_name: 'Apparel', category_name: 'Cleats',
    customer_segment: 'Consumer', quantity: '1', product_price: '59.99', discount_rate: '0.05', save_to_records: false,
  })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    const next = { ...form, [k]: v }
    if (k === 'market') next.order_region = opts.region_by_market[v]?.[0] || ''
    if (k === 'department_name') next.category_name = opts.category_by_department[v]?.[0] || ''
    if (k === 'shipping_mode') next.scheduled_shipping_days = String(opts.scheduled_days_by_mode[v]?.[0] ?? '')
    setForm(next)
  }

  const submit = async (e) => {
    e.preventDefault()
    const body = { ...form, order_id: form.order_id.trim() || null, scheduled_shipping_days: Number(form.scheduled_shipping_days),
      quantity: Number(form.quantity), product_price: Number(form.product_price), discount_rate: Number(form.discount_rate) }
    if (!form.order_date) { setError('Order date is required.'); return }
    if (!(body.quantity >= 1)) { setError('Quantity must be at least 1.'); return }
    if (!(body.product_price > 0)) { setError('Product price must be greater than 0.'); return }
    if (!(body.discount_rate >= 0 && body.discount_rate <= 1)) { setError('Discount rate must be between 0 and 1 (e.g. 0.05 = 5%).'); return }
    setBusy(true); setError('')
    try {
      const r = await api('/api/shipments/predict', { method: 'POST', body })
      setResult(r)
      if (form.save_to_records) onPredicted()
    } catch (err) { setError(err.message); setResult(null) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <ErrorBanner message={error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Order ID (optional)"><Input value={form.order_id} onChange={set('order_id')} placeholder="ORD-1001" /></Field>
          <Field label="Order date & time"><Input type="datetime-local" value={form.order_date} onChange={set('order_date')} /></Field>
          <Field label="Payment type"><Select value={form.payment_type} onChange={set('payment_type')} options={opts.payment_type} /></Field>
          <Field label="Shipping mode"><Select value={form.shipping_mode} onChange={set('shipping_mode')} options={opts.shipping_mode} /></Field>
          <Field label="Scheduled days"><Select value={form.scheduled_shipping_days} onChange={set('scheduled_shipping_days')} options={(opts.scheduled_days_by_mode[form.shipping_mode] || []).map(String)} /></Field>
          <Field label="Customer segment"><Select value={form.customer_segment} onChange={set('customer_segment')} options={opts.customer_segment} /></Field>
          <Field label="Market"><Select value={form.market} onChange={set('market')} options={opts.market} /></Field>
          <Field label="Order region"><Select value={form.order_region} onChange={set('order_region')} options={opts.region_by_market[form.market] || []} /></Field>
          <Field label="Department"><Select value={form.department_name} onChange={set('department_name')} options={opts.department_name} /></Field>
          <Field label="Category"><Select value={form.category_name} onChange={set('category_name')} options={opts.category_by_department[form.department_name] || []} /></Field>
          <Field label="Quantity"><Input type="number" min="1" value={form.quantity} onChange={set('quantity')} /></Field>
          <Field label="Unit price"><Input type="number" min="0.01" step="0.01" value={form.product_price} onChange={set('product_price')} /></Field>
          <Field label="Discount rate (0-1)"><Input type="number" min="0" max="1" step="0.01" value={form.discount_rate} onChange={set('discount_rate')} /></Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.save_to_records} onChange={set('save_to_records')} className="h-4 w-4 accent-[#2a78d6]" />Also add this shipment to the shipment records
        </label>
        <Button type="submit" loading={busy} className="mt-4">Predict late delivery</Button>
      </div>
      <div className="lg:col-span-2"><PredictionResult result={result} positiveLabel="Late delivery expected" negativeLabel="On-time delivery expected" probabilityLabel="Late-delivery probability" /></div>
    </form>
  )
}

const SOURCE_LABEL = { dataco: 'DataCo hold-out (historical)', manual: 'User prediction / CSV', order: 'Customer order' }

// Outbound (customer orders) and inbound (purchase orders) logistics tracking
function Logistics() {
  const out = useApi('/api/shipments/outbound')
  const inbound = useApi('/api/purchase-orders')
  const [tab, setTab] = useState('outbound')
  const sm = out.data?.summary
  const inRows = (inbound.data?.items || []).filter((p) => ['Ordered', 'Received'].includes(p.status))
  return (
    <Card title="Logistics tracking" subtitle="Outbound shipments of customer orders and inbound purchase-order deliveries"
      actions={<Button variant="ghost" size="sm" icon="refresh" onClick={() => { out.reload(); inbound.reload() }}>Refresh</Button>}>
      {sm && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Active outbound" value={sm.active} hint="Planned or in transit" />
          <StatCard label="In transit" value={sm.in_transit} />
          <StatCard label="High risk (active)" value={sm.high_risk_active} tone={sm.high_risk_active ? 'High' : 'Low'} hint="ML prediction" />
          <StatCard label="Delayed (active)" value={sm.delayed} tone={sm.delayed ? 'High' : 'Low'} hint="Past expected date" />
          <StatCard label="Inbound late" value={inbound.data?.inbound_delayed ?? '-'} tone={inbound.data?.inbound_delayed ? 'High' : 'Low'} hint="Ordered POs past expected arrival" />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'outbound', label: 'Outbound (customer orders)', count: out.data?.items.length }, { value: 'inbound', label: 'Inbound (purchase orders)', count: inRows.length }]} />
      {tab === 'outbound' && (out.loading && !out.data ? <Loading /> : <>
        <ErrorBanner message={out.error} onRetry={out.reload} />
        <Table rows={out.data?.items} maxHeight={420} empty="No order shipments yet. Shipments are created when a customer order is confirmed." columns={[
          { key: 'shipment_code', label: 'Shipment' },
          { key: 'order_number', label: 'Order', render: (r) => <Link to="/orders" className="font-medium text-accent hover:underline">{r.order_number}</Link> },
          { key: 'customer_name', label: 'Customer', render: (r) => <span className="block max-w-48 truncate">{r.customer_name}</span> },
          { key: 'shipping_mode', label: 'Mode' },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'late_probability', label: 'Late prob.', render: (r) => <div className="flex items-center gap-2"><ProbabilityBar value={r.late_probability} /><RiskBadge level={r.risk_level} /></div> },
          { key: 'expected_delivery_date', label: 'Expected', render: (r) => fmtDate(r.expected_delivery_date) },
          { key: 'actual_delivery_date', label: 'Delivered', render: (r) => fmtDate(r.actual_delivery_date) },
          { key: 'delay', label: 'Observed delay', render: (r) => (r.is_delayed ? <span className="font-medium text-risk-high">{r.days_late} d late</span> : r.status === 'Delivered' ? 'On time' : '-') },
          { key: 'recommendation', label: 'Recommended action', wrap: true, render: (r) => <span className="line-clamp-2 block w-64 whitespace-normal text-xs text-gray-600" title={r.recommendation}>{r.recommendation}</span> },
        ]} />
      </>)}
      {tab === 'inbound' && (inbound.loading && !inbound.data ? <Loading /> : (
        <Table rows={inRows} maxHeight={420} empty="No purchase orders have been sent to suppliers yet." columns={[
          { key: 'po_number', label: 'PO', render: (p) => <Link to="/purchase-orders" className="font-medium text-accent hover:underline">{p.po_number}</Link> },
          { key: 'supplier_name', label: 'Supplier', render: (p) => <span className="flex items-center gap-1.5">{p.supplier_name}<RiskBadge level={p.supplier_risk_level} /></span> },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'units', label: 'Units', align: 'right', render: (p) => fmtNum(p.units) },
          { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          { key: 'expected_arrival_date', label: 'Expected arrival', render: (p) => fmtDate(p.expected_arrival_date) },
          { key: 'actual_arrival_date', label: 'Actual arrival', render: (p) => fmtDate(p.actual_arrival_date) },
          { key: 'delay', label: 'Delay', render: (p) => (p.is_delayed ? <span className="font-medium text-risk-high">{p.days_late} d late</span> : p.status === 'Received' ? 'On time' : '-') },
        ]} />
      ))}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500"><BasisTag kind="ml">ML prediction</BasisTag> late-delivery probability from the DataCo Random Forest. <BasisTag kind="observed">Observed</BasisTag> delays compare expected and actual dates.</p>
    </Card>
  )
}

export default function Transportation() {
  const options = useApi('/api/shipments/options')
  const stats = useApi('/api/shipments/stats')
  const [risk, setRisk] = useState('')
  const [source, setSource] = useState('')
  const [page, setPage] = useState(1)
  const list = useApi(`/api/shipments?page=${page}&page_size=20${risk ? `&risk=${risk}` : ''}${source ? `&source=${source}` : ''}`)
  useEffect(() => { setPage(1) }, [risk, source])
  const refresh = () => { list.reload(); stats.reload() }

  const columns = [
    { key: 'order_id', label: 'Order' },
    { key: 'order_date', label: 'Order date', render: (s) => s.order_date ? new Date(s.order_date).toLocaleDateString() : '-' },
    { key: 'product_name', label: 'Product', render: (s) => <span className="block max-w-48 truncate">{s.product_name || s.category_name}</span> },
    { key: 'market', label: 'Market / region', render: (s) => <span className="text-xs">{s.market} · {s.order_region}</span> },
    { key: 'shipping_mode', label: 'Mode' },
    { key: 'scheduled_shipping_days', label: 'Sched. days', align: 'right' },
    { key: 'quantity', label: 'Qty', align: 'right' },
    { key: 'late_probability', label: 'Late prob.', render: (s) => <ProbabilityBar value={s.late_probability} /> },
    { key: 'risk_level', label: 'Risk', render: (s) => <RiskBadge level={s.risk_level} /> },
    { key: 'actual_late', label: 'Actual outcome', render: (s) => s.actual_late == null ? <span className="text-gray-400">pending</span> : s.actual_late ? 'Late' : 'On time' },
    { key: 'source', label: 'Record source', render: (s) => <span className="text-xs text-gray-600">{SOURCE_LABEL[s.source] || '-'}</span> },
    { key: 'recommendation', label: 'Recommended action', wrap: true, render: (s) => <span title={s.recommendation} className="line-clamp-2 w-72 whitespace-normal text-xs text-gray-600">{s.recommendation}</span> },
  ]

  return (
    <div>
      <PageHeader title="Transportation" description="Outbound and inbound logistics tracking, plus late-delivery risk prediction using a Random Forest trained on the DataCo Smart Supply Chain dataset (only information available at order time)." />

      <div className="mb-6"><Logistics /></div>

      <Card title="Predict late delivery for a new order">
        {options.loading ? <Loading /> : options.error ? <ErrorBanner message={options.error} onRetry={options.reload} /> : <PredictForm opts={options.data} onPredicted={refresh} />}
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title="Shipment delay risk">{stats.data ? <RiskBarChart data={['Low', 'Medium', 'High'].map((l) => ({ level: l, count: stats.data.by_risk[l] }))} name="Shipments" /> : <Loading />}</Card>
        <Card title="Risk by shipping mode" className="lg:col-span-2">
          {stats.data ? (
            <>
              <Table rowKey="shipping_mode" columns={[
                { key: 'shipping_mode', label: 'Shipping mode' },
                { key: 'shipments', label: 'Shipments', align: 'right' },
                { key: 'predicted_late', label: 'Predicted late', align: 'right' },
                { key: 'avg_late_probability', label: 'Avg. late probability', render: (r) => <ProbabilityBar value={r.avg_late_probability} /> },
              ]} rows={stats.data.by_mode} />
              {stats.data.accuracy_on_records != null && (
                <p className="mt-3 text-xs text-gray-500">On the {stats.data.records_with_known_outcome} seeded hold-out shipments with a known outcome, the model's predictions match the actual result {fmtPct(stats.data.accuracy_on_records)} of the time.</p>
              )}
            </>
          ) : <Loading />}
        </Card>
      </div>

      <div className="mt-6"><ModelMetrics modelKey="late_delivery" title="Model comparison - Random Forest vs Logistic Regression" /></div>

      <Card className="mt-6" title="Shipment records" subtitle="Sorted by late-delivery probability. DataCo hold-out records are historical orders from the test split (their real outcome is shown)."
        actions={<>
          <Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="All sources" options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))} className="w-56" />
          <Select value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="All risk levels" options={['High', 'Medium', 'Low']} className="w-40" />
        </>}>
        <ErrorBanner message={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Loading /> : list.data && (
          <>
            <div className={list.loading ? 'opacity-60' : ''}><Table columns={columns} rows={list.data.items} /></div>
            <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Card>

      <Card className="mt-6" title="Batch prediction (CSV)" subtitle="Upload new orders; categorical values must match those in the DataCo dataset (see template).">
        <CsvUpload uploadPath="/api/shipments/upload" templatePath="/api/shipments/template" templateName="shipments_template.csv" onDone={refresh}
          describe={(r) => `Predicted ${r.processed} shipment(s), rejected ${r.rejected} row(s). High risk: ${r.results.filter((x) => x.risk_level === 'High').length}.`} />
      </Card>
    </div>
  )
}
