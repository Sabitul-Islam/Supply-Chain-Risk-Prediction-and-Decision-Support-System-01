import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BasisTag, Button, Card, ErrorBanner, Loading, PageHeader, ProbabilityBar, RiskBadge, StatusBadge, Table, Tabs, basisKind } from '../components/ui.jsx'
import { fmtDate, fmtNum } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const LEVEL_BAR = { Low: 'bg-risk-low', Medium: 'bg-risk-medium', High: 'bg-risk-high' }

// One domain of the integrated risk overview: index, level (always as text), counts and evidence type.
export function DomainCard({ d }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">{d.label}</p>
        {d.level ? <RiskBadge level={d.level} /> : <span className="text-xs text-gray-400">no data</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-gray-900">{d.score ?? '-'}<span className="text-sm font-normal text-gray-400"> / 100</span></p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100" aria-hidden="true"><div className={`h-1.5 rounded-full ${LEVEL_BAR[d.level] || ''}`} style={{ width: `${d.score || 0}%` }} /></div>
      <p className="mt-2 text-xs text-gray-600">{d.counts.High} High · {d.counts.Medium} Medium · {d.counts.Low} Low of {d.assessed} {d.scope}</p>
      <div className="mt-2" title={d.basis}><BasisTag kind={basisKind(d.basis)}>{d.basis.split(/[:(]/)[0].replace(/ on simulated.*/, ' (sample data)').trim()}</BasisTag></div>
    </div>
  )
}

export function ActionList({ actions, compact }) {
  if (!actions?.length) return <p className="text-sm text-gray-500">No actions needed - all monitored risks are Low.</p>
  return (
    <ul className="divide-y divide-gray-100">
      {actions.map((a, i) => (
        <li key={i} className="flex gap-3 py-2.5">
          <span className="mt-0.5 shrink-0"><RiskBadge level={a.priority} /></span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-gray-900">{a.domain}: {a.title}</p>
            {!compact && <p className="mt-0.5 text-gray-600">{a.detail}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2"><BasisTag kind={basisKind(a.basis)}>{a.basis}</BasisTag>
              <Link to={a.link} className="text-xs font-medium text-accent hover:underline">Open module →</Link></div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Shortage({ s }) {
  return (
    <>
      <p className="mb-3 text-sm text-gray-600">{s.total} stock records at stockout risk ({s.high} High). Total recommended replenishment: <b>{fmtNum(s.units_to_order)} units</b>. <Link to="/purchase-orders" className="font-medium text-accent hover:underline">Create purchase orders →</Link></p>
      <Table rowKey="inventory_id" rows={s.items} maxHeight={480} empty="No inventory shortages." columns={[
        { key: 'product_name', label: 'Product / warehouse', render: (p) => <div><p className="max-w-60 truncate font-medium text-gray-900">{p.product_name}</p><p className="text-xs text-gray-500">{p.warehouse}</p></div> },
        { key: 'stockout_risk', label: 'Stockout', render: (p) => <RiskBadge level={p.stockout_risk} /> },
        { key: 'cover', label: 'Cover / lead (d)', align: 'right', render: (p) => `${fmtNum(p.days_of_cover, 1)} / ${p.lead_time_days}` },
        { key: 'fc', label: 'Forecast demand/day', align: 'right', render: (p) => p.forecast_daily == null ? 'n/a' : fmtNum(p.forecast_daily, 1) },
        { key: 'on_order', label: 'On order', align: 'right', render: (p) => fmtNum(p.on_order) },
        { key: 'replenishment_qty', label: 'Order qty', align: 'right', render: (p) => <b>{fmtNum(p.replenishment_qty)}</b> },
        { key: 'sup', label: 'Recommended supplier', render: (p) => p.recommended_supplier ? <span className="flex items-center gap-1.5">{p.recommended_supplier.name}<RiskBadge level={p.recommended_supplier.risk_level} /></span> : '-' },
        { key: 'action', label: 'Action', wrap: true, render: (p) => <span className="block w-64 whitespace-normal text-xs text-gray-600">{p.action}</span> },
      ]} />
    </>
  )
}

function Suppliers({ s }) {
  if (!s.suppliers.length) return <p className="text-sm text-gray-500">No high-risk suppliers.</p>
  return (
    <div className="space-y-3">
      {s.suppliers.map((x) => (
        <div key={x.supplier_id} className="rounded-lg border border-gray-200 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b className="text-gray-900">{x.name}</b><span className="text-gray-500">{x.supplier_code} · {x.country} · {x.category}</span><RiskBadge level={x.risk_level} /><span className="tabular-nums text-gray-700">score {x.risk_score}</span></div>
          <p className="mt-2 text-gray-600">{x.product_count} associated product(s), {x.stocked_records} stocked record(s), {fmtNum(x.net_units_in_stock)} net units in stock. {x.open_purchase_orders.length} open PO(s){x.open_purchase_orders.length ? `: ${x.open_purchase_orders.map((p) => `${p.po_number} (${p.status})`).join(', ')}` : ''}.</p>
          {x.products_at_stockout_risk.length > 0 && <p className="mt-1 text-gray-600">At stockout risk: {x.products_at_stockout_risk.map((p) => `${p.product_name} (${p.stockout_risk}, ${p.warehouse})`).join('; ')}</p>}
          <p className="mt-1 text-gray-600">Alternatives: {x.alternatives.length ? x.alternatives.map((a) => `${a.name} (${a.risk_level}, score ${a.risk_score}, lead ${a.avg_lead_time_days} d)`).join('; ') : 'none with lower risk in this category'}</p>
          <p className="mt-2 rounded bg-gray-50 p-2 text-gray-800"><b>Recommendation: </b>{x.recommendation}</p>
        </div>
      ))}
    </div>
  )
}

function Delays({ s }) {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Outbound: active order shipments at risk</h4>
        <Table rowKey="order_number" rows={s.outbound} empty="No active order shipment is delayed or at Medium/High predicted risk." columns={[
          { key: 'order_number', label: 'Order', render: (x) => <Link to="/orders" className="font-medium text-accent hover:underline">{x.order_number}</Link> },
          { key: 'customer_name', label: 'Customer', render: (x) => <span className="block max-w-48 truncate">{x.customer_name}</span> },
          { key: 'st', label: 'Shipment', render: (x) => <StatusBadge status={x.shipment.status} /> },
          { key: 'p', label: 'Late prob.', render: (x) => <div className="flex items-center gap-2"><ProbabilityBar value={x.shipment.late_probability} /><RiskBadge level={x.shipment.risk_level} /></div> },
          { key: 'exp', label: 'Expected', render: (x) => <span className={x.shipment.is_delayed ? 'font-medium text-risk-high' : ''}>{fmtDate(x.shipment.expected_delivery_date)}{x.shipment.is_delayed ? ` (+${x.shipment.days_late} d)` : ''}</span> },
          { key: 'impact', label: 'Affected products / impact', wrap: true, render: (x) => <span className="block w-64 whitespace-normal text-xs text-gray-600">{x.products.join(', ')} - {x.impact}</span> },
          { key: 'actions', label: 'Preventive actions', wrap: true, render: (x) => <span className="block w-72 whitespace-normal text-xs text-gray-600">{x.actions.join(' ')}</span> },
        ]} />
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold text-gray-900">Inbound: purchase orders that are late or arrive after stock runs out</h4>
        <Table rowKey="po_number" rows={s.inbound} empty="No inbound delivery is late or arriving after a stockout." columns={[
          { key: 'po_number', label: 'PO', render: (x) => <Link to="/purchase-orders" className="font-medium text-accent hover:underline">{x.po_number}</Link> },
          { key: 'supplier_name', label: 'Supplier', render: (x) => <span className="flex items-center gap-1.5">{x.supplier_name}<RiskBadge level={x.supplier_risk_level} /></span> },
          { key: 'expected_arrival_date', label: 'Expected', render: (x) => fmtDate(x.expected_arrival_date) },
          { key: 'late', label: 'Delay', render: (x) => (x.is_delayed ? <span className="font-medium text-risk-high">{x.days_late} d late</span> : 'not yet') },
          { key: 'aff', label: 'Affected stock', wrap: true, render: (x) => <span className="block w-72 whitespace-normal text-xs text-gray-600">{x.affected_stock.map((a) => `${a.product_name} (${a.stockout_risk}, cover ${a.days_of_cover} d${a.runs_out_before_arrival ? ', runs out before arrival' : ''})`).join('; ') || '-'}</span> },
          { key: 'action', label: 'Action', wrap: true, render: (x) => <span className="block w-56 whitespace-normal text-xs text-gray-600">{x.action}</span> },
        ]} />
      </div>
      <p className="text-xs text-gray-500">Context: {s.historical_high_risk_records} of the DataCo hold-out shipment records (historical, shown on Transportation) are High risk. Delays above are <b>observed</b> from expected vs actual dates; risk levels are <b>model predictions</b>.</p>
    </div>
  )
}

function Equipment({ s }) {
  return (
    <>
      <p className="mb-3 text-sm text-gray-600">{s.high} machine(s) at High and {s.medium} at Medium predicted failure risk. {s.note}</p>
      <Table rows={s.machines} empty="No machine at Medium or High risk." columns={[
        { key: 'machine_code', label: 'Machine', render: (m) => <Link to="/production" className="font-medium text-accent hover:underline">{m.machine_code}</Link> },
        { key: 'machine_type', label: 'Type' },
        { key: 'failure_probability', label: 'Failure prob.', render: (m) => <ProbabilityBar value={m.failure_probability} /> },
        { key: 'risk_level', label: 'Risk', render: (m) => <RiskBadge level={m.risk_level} /> },
        { key: 'tool_wear_min', label: 'Tool wear (min)', align: 'right' },
        { key: 'recommendation', label: 'Maintenance recommendation', wrap: true, render: (m) => <span className="block w-72 whitespace-normal text-xs text-gray-600">{m.recommendation}</span> },
        { key: 'implication', label: 'Operational implication', wrap: true, render: (m) => <span className="block w-64 whitespace-normal text-xs text-gray-600">{m.implication}</span> },
      ]} />
    </>
  )
}

function DemandPlan({ s }) {
  return (
    <>
      <p className="mb-3 text-sm text-gray-600">Compares the next-month demand forecast with the historical demand rate used to set each reorder level. Gap &gt; +20% = High, &gt; +5% = Medium.</p>
      <Table rowKey="inventory_id" rows={s.items} maxHeight={480} columns={[
        { key: 'product_name', label: 'Product / warehouse', render: (p) => <div><p className="max-w-64 truncate font-medium text-gray-900">{p.product_name}</p><p className="text-xs text-gray-500">{p.warehouse}</p></div> },
        { key: 'historical_daily', label: 'Historical / day', align: 'right', render: (p) => fmtNum(p.historical_daily, 2) },
        { key: 'forecast_daily', label: 'Forecast / day', align: 'right', render: (p) => fmtNum(p.forecast_daily, 2) },
        { key: 'gap_pct', label: 'Gap', align: 'right', render: (p) => (p.gap_pct == null ? '-' : `${p.gap_pct > 0 ? '+' : ''}${p.gap_pct}%`) },
        { key: 'demand_risk', label: 'Demand risk', render: (p) => <RiskBadge level={p.demand_risk} /> },
        { key: 'stockout_risk', label: 'Stockout risk', render: (p) => <RiskBadge level={p.stockout_risk} /> },
      ]} />
    </>
  )
}

export default function DecisionSupport() {
  const { data, loading, error, reload } = useApi('/api/decision/report')
  const [tab, setTab] = useState('shortage')
  if (loading && !data) return <Loading label="Combining module data..." />
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />
  const ov = data.overview
  return (
    <div>
      <PageHeader title="Decision Support" description="Integrated risk engine: combines supplier, inventory, production, transportation and demand information into one overview and prioritised actions."
        actions={<Button variant="secondary" icon="refresh" onClick={reload} loading={loading}>Refresh</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        Evidence types: <BasisTag kind="ml">ML prediction</BasisTag><BasisTag kind="rule">Rule-based assessment</BasisTag><BasisTag kind="forecast">Statistical forecast</BasisTag><BasisTag kind="observed">Observed</BasisTag><BasisTag kind="sample">Sample data</BasisTag>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4 lg:col-span-1">
          <p className="text-sm font-medium text-gray-700">Overall supply chain risk</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums text-gray-900">{ov.overall.score ?? '-'}</p>
          <div className="mt-2">{ov.overall.level && <RiskBadge level={ov.overall.level} />}</div>
          <p className="mt-3 text-xs text-gray-500">Average of the five domain indices</p>
        </div>
        {ov.domains.map((d) => <div key={d.key} className="lg:col-span-1"><DomainCard d={d} /></div>)}
      </div>
      <p className="mt-2 text-xs text-gray-500">{ov.formula}</p>

      <Card className="mt-6" title="Priority actions" subtitle="Ranked High → Low across all modules"><ActionList actions={data.actions} /></Card>

      <Card className="mt-6" title="Scenario analysis">
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'shortage', label: 'Inventory shortage', count: data.inventory_shortage.total },
          { value: 'supplier', label: 'Supplier risk', count: data.supplier_risk.suppliers.length },
          { value: 'delay', label: 'Shipment & inbound delays', count: data.shipment_delay.outbound.length + data.shipment_delay.inbound.length },
          { value: 'equipment', label: 'Equipment failure', count: data.equipment.machines.length },
          { value: 'demand', label: 'Demand vs plan', count: data.demand_plan.items.filter((p) => p.demand_risk !== 'Low').length },
        ]} />
        <p className="mb-3 text-xs text-gray-500">Basis: {{ shortage: data.inventory_shortage.basis, supplier: data.supplier_risk.basis, delay: data.shipment_delay.basis, equipment: data.equipment.basis, demand: data.demand_plan.basis }[tab]}</p>
        {tab === 'shortage' && <Shortage s={data.inventory_shortage} />}
        {tab === 'supplier' && <Suppliers s={data.supplier_risk} />}
        {tab === 'delay' && <Delays s={data.shipment_delay} />}
        {tab === 'equipment' && <Equipment s={data.equipment} />}
        {tab === 'demand' && <DemandPlan s={data.demand_plan} />}
      </Card>
      <p className="mt-4 text-xs text-gray-500">Report generated {fmtDate(data.generated_for)} from the current database records. Late-delivery and failure percentages are model probabilities, not certainties.</p>
    </div>
  )
}
