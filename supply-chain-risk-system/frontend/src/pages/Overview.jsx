import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip, RiskBarChart, SERIES, axisProps, gridProps } from '../components/charts.jsx'
import { Button, Card, ErrorBanner, Loading, PageHeader, StatCard } from '../components/ui.jsx'
import { fmtNum, fmtPct } from '../services/api.js'
import { useApi } from '../services/useApi.js'
import { ActionList, DomainCard } from './DecisionSupport.jsx'

function AlertList({ title, to, items, render, empty }) {
  return (
    <Card title={title} actions={<Link to={to} className="text-sm font-medium text-accent hover:underline">View all</Link>}>
      {items.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="divide-y divide-gray-100">{items.map((it, i) => <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">{render(it)}</li>)}</ul>
      )}
    </Card>
  )
}

export default function Overview() {
  const { data, loading, error, reload } = useApi('/api/dashboard/summary')
  if (loading && !data) return <Loading label="Loading dashboard..." />
  if (error && !data) return <ErrorBanner message={error} onRetry={reload} />
  const { cards, charts, alerts, risk_overview: ov, actions } = data
  // demand history (last 12 months) joined with the 3-month forecast; the forecast line starts at the last actual
  const demandRows = [...charts.monthly_demand.map((m) => ({ month: m.month, actual: m.quantity })),
    ...charts.demand_forecast.map((f) => ({ month: f.month, forecast: f.forecast }))]
  const lastActual = charts.monthly_demand.length - 1
  if (lastActual >= 0 && charts.demand_forecast.length) demandRows[lastActual].forecast = demandRows[lastActual].actual

  return (
    <div>
      <PageHeader title="Supply Chain Control Tower" description="Live overview across sourcing, production, inventory, orders, transportation and returns. Every number is calculated from database records."
        actions={<Button variant="secondary" icon="refresh" onClick={reload} loading={loading}>Refresh</Button>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total suppliers" value={cards.total_suppliers} icon="procurement" hint={`${cards.open_purchase_orders} open purchase orders`} />
        <StatCard label="Total products" value={cards.total_products} icon="inventory" hint="DataCo product catalogue" />
        <StatCard label="Total orders" value={cards.total_orders} icon="orders" hint={`${cards.open_orders} open · ${cards.delayed_orders} delayed`} />
        <StatCard label="Total shipments" value={fmtNum(cards.total_shipments)} icon="transportation" hint={`${cards.active_shipments} active order shipments`} />
        <StatCard label="Inventory alerts" value={cards.inventory_alerts} tone={cards.inventory_alerts ? 'Medium' : 'Low'} hint="Stock at or below reorder level" />
        <StatCard label="High-risk suppliers" value={cards.high_risk_suppliers} tone={cards.high_risk_suppliers ? 'High' : 'Low'} hint="Rule-based score ≥ 60" />
        <StatCard label="High-risk shipments" value={cards.shipment_delay_alerts} tone={cards.shipment_delay_alerts ? 'High' : 'Low'} hint={`Late prob. ≥ 60% · ${cards.high_risk_active_shipments} active`} />
        <StatCard label="Machine failure alerts" value={cards.machine_failure_alerts} tone={cards.machine_failure_alerts ? 'High' : 'Low'} hint="Failure probability ≥ 50%" />
      </div>

      <Card className="mt-6" title="Supply chain risk overview" subtitle={ov.formula}
        actions={<Link to="/decision" className="text-sm font-medium text-accent hover:underline">Open decision support →</Link>}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">Overall index</p>
            <p className="mt-2 text-4xl font-semibold tabular-nums text-gray-900">{ov.overall.score ?? '-'}</p>
            <p className="mt-1 text-sm font-medium text-gray-700">{ov.overall.level ? `${ov.overall.level} risk` : ''}</p>
          </div>
          {ov.domains.map((d) => <DomainCard key={d.key} d={d} />)}
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Top priority actions" actions={<Link to="/decision" className="text-sm font-medium text-accent hover:underline">All actions</Link>}>
          <ActionList actions={actions} compact />
        </Card>
        <Card className="lg:col-span-2" title="Orders by status" subtitle={`${cards.pending_returns} return(s) in progress · ${cards.inbound_delayed} inbound PO(s) late`}>
          {cards.total_orders === 0 ? <p className="text-sm text-gray-500">No customer orders yet. <Link to="/orders" className="text-accent hover:underline">Create one</Link>.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={charts.order_status} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0ef" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis type="category" dataKey="status" {...axisProps} width={118} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                <Bar isAnimationActive={false} dataKey="count" name="Orders" fill={SERIES.primary} radius={[0, 4, 4, 0]} barSize={14}>
                  <LabelList dataKey="count" position="right" fill="#374151" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Demand trend and 3-month forecast (units)" subtitle="Real DataCo demand, last 12 months of the consistent period + exponential-smoothing forecast"
          actions={<Link to="/demand" className="text-sm font-medium text-accent hover:underline">Details</Link>}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={demandRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" {...axisProps} minTickGap={16} />
              <YAxis {...axisProps} width={56} />
              <Tooltip content={<ChartTooltip formatter={(v) => fmtNum(v)} />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#374151' }} verticalAlign="top" align="right" />
              <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual demand" stroke={SERIES.secondary} strokeWidth={2} dot={{ r: 3 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="forecast" name="Forecast" stroke={SERIES.primary} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Average predicted late-delivery probability" subtitle="By shipping mode, all shipment records (Random Forest)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={charts.shipment_by_mode} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="shipping_mode" {...axisProps} />
              <YAxis {...axisProps} domain={[0, 1]} tickFormatter={(v) => `${v * 100}%`} width={48} />
              <Tooltip content={<ChartTooltip formatter={(v) => fmtPct(v)} />} cursor={{ fill: '#f9fafb' }} />
              <Bar isAnimationActive={false} dataKey="avg_late_probability" name="Avg. late probability" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Supplier risk"><RiskBarChart data={charts.supplier_risk} name="Suppliers" /></Card>
        <Card title="Machine failure risk"><RiskBarChart data={charts.machine_risk} name="Machines" /></Card>
        <Card title="Shipment delay risk"><RiskBarChart data={charts.shipment_risk} name="Shipments" /></Card>
        <Card title="Stockout risk"><RiskBarChart data={charts.inventory_risk} name="Inventory items" /></Card>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AlertList title="High-risk suppliers" to="/procurement" items={alerts.suppliers} empty="No high-risk suppliers."
          render={(s) => <><span className="truncate text-gray-800">{s.name}</span><span className="font-medium tabular-nums text-risk-high">{s.risk_score}</span></>} />
        <AlertList title="Machine failure alerts" to="/production" items={alerts.machines} empty="No machines at high risk."
          render={(m) => <><span className="text-gray-800">{m.machine_code}</span><span className="font-medium tabular-nums text-risk-high">{fmtPct(m.failure_probability)}</span></>} />
        <AlertList title="Shipment delay alerts" to="/transportation" items={alerts.shipments} empty="No high-risk shipments."
          render={(s) => <><span className="text-gray-800">#{s.order_id} · {s.shipping_mode}</span><span className="font-medium tabular-nums text-risk-high">{fmtPct(s.late_probability)}</span></>} />
        <AlertList title="Inventory alerts" to="/inventory" items={alerts.inventory} empty="All stock levels healthy."
          render={(i) => <><span className="truncate text-gray-800">{i.product_name}</span><span className="shrink-0 tabular-nums text-gray-600">{i.net_stock} / {i.reorder_level}</span></>} />
      </div>
    </div>
  )
}
