import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip, RiskBarChart, SERIES, axisProps, gridProps } from '../components/charts.jsx'
import { Button, Card, ErrorBanner, Loading, PageHeader, StatCard } from '../components/ui.jsx'
import { fmtPct } from '../services/api.js'
import { useApi } from '../services/useApi.js'

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
  const { cards, charts, alerts } = data

  return (
    <div>
      <PageHeader title="Overview" description="Live summary of supplier, production, inventory and transportation risk across the supply chain."
        actions={<Button variant="secondary" icon="refresh" onClick={reload} loading={loading}>Refresh</Button>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total suppliers" value={cards.total_suppliers} icon="procurement" />
        <StatCard label="Total products" value={cards.total_products} icon="inventory" />
        <StatCard label="Total shipments" value={cards.total_shipments.toLocaleString()} icon="transportation" />
        <StatCard label="Machines monitored" value={cards.total_machines} icon="production" />
        <StatCard label="High-risk suppliers" value={cards.high_risk_suppliers} tone={cards.high_risk_suppliers ? 'High' : 'Low'} hint="Rule-based score ≥ 60" />
        <StatCard label="Machine failure alerts" value={cards.machine_failure_alerts} tone={cards.machine_failure_alerts ? 'High' : 'Low'} hint="Failure probability ≥ 50%" />
        <StatCard label="Shipment delay alerts" value={cards.shipment_delay_alerts} tone={cards.shipment_delay_alerts ? 'High' : 'Low'} hint="Late probability ≥ 60%" />
        <StatCard label="Inventory alerts" value={cards.inventory_alerts} tone={cards.inventory_alerts ? 'Medium' : 'Low'} hint="At or below reorder level" />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Supplier risk"><RiskBarChart data={charts.supplier_risk} name="Suppliers" /></Card>
        <Card title="Machine failure risk"><RiskBarChart data={charts.machine_risk} name="Machines" /></Card>
        <Card title="Shipment delay risk"><RiskBarChart data={charts.shipment_risk} name="Shipments" /></Card>
        <Card title="Stockout risk"><RiskBarChart data={charts.inventory_risk} name="Inventory items" /></Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Monthly demand (units)" subtitle="Last 12 months of the consistent DataCo period">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={charts.monthly_demand} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="month" {...axisProps} />
              <YAxis {...axisProps} width={56} />
              <Tooltip content={<ChartTooltip />} />
              <Line isAnimationActive={false} type="monotone" dataKey="quantity" name="Units ordered" stroke={SERIES.primary} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Average predicted late-delivery probability" subtitle="By shipping mode (Random Forest)">
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
