import { useEffect, useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip, SERIES, axisProps, gridProps } from '../components/charts.jsx'
import { Link } from 'react-router-dom'
import { Card, ErrorBanner, Input, Loading, PageHeader, RiskBadge, Select, StatCard, Table } from '../components/ui.jsx'
import { fmtNum } from '../services/api.js'
import { useApi } from '../services/useApi.js'

function TrendText({ t }) {
  const sign = t.pct_per_month > 0 ? '+' : ''
  return <span><b className="text-gray-900">{t.direction}</b> ({sign}{t.pct_per_month}% of mean per month over the last {t.months} months)</span>
}

function DemandChart({ data, height = 280 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="month" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={56} />
        <Tooltip content={<ChartTooltip formatter={(v) => fmtNum(v, 0)} />} cursor={{ fill: '#f9fafb' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#374151' }} verticalAlign="top" align="right" />
        <Bar isAnimationActive={false} dataKey="quantity" name="Units ordered" fill={SERIES.primary} radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Line isAnimationActive={false} type="monotone" dataKey="moving_avg_3m" name="3-month moving average" stroke={SERIES.secondary} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}


// Forecast panel: calls /api/demand/forecast (all products) or /api/demand/forecast/{id} (one product).
// The server fits simple exponential smoothing on the monthly history; the chart joins history + forecast.
function ForecastPanel({ url, history, title }) {
  const f = useApi(url)
  if (f.loading) return <Loading />
  if (f.error) return <ErrorBanner message={f.error} onRetry={f.reload} />
  const d = f.data
  if (!d?.available) return <p className="text-sm text-gray-500">{d?.reason || 'Forecast not available.'}</p>

  const past = (history || []).filter((m) => m.month <= d.last_actual_month).slice(-12)
  const rows = [
    ...past.map((m) => ({ month: m.month, actual: m.quantity })),
    // connect the forecast line to the last actual point
    ...d.forecast.map((r) => ({ month: r.month, forecast: r.forecast, range: [r.lower, r.upper], })),
  ]
  if (past.length) rows[past.length - 1].forecast = past[past.length - 1].quantity
  const b = d.backtest
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        {d.forecast.slice(0, 4).map((r) => (
          <div key={r.month} className="rounded-lg border border-gray-200 px-3 py-2">
            <p className="text-xs text-gray-500">{r.month}</p>
            <p className="text-lg font-semibold text-gray-900">{fmtNum(r.forecast)} <span className="text-xs font-normal text-gray-500">units</span></p>
            <p className="text-xs text-gray-500">range {fmtNum(r.lower)} - {fmtNum(r.upper)}</p>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" {...axisProps} minTickGap={16} />
          <YAxis {...axisProps} width={56} domain={[0, 'auto']} />
          <Tooltip content={<ChartTooltip formatter={(v) => (Array.isArray(v) ? `${fmtNum(v[0])} - ${fmtNum(v[1])}` : fmtNum(v))} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#374151' }} verticalAlign="top" align="right" />
          <Area isAnimationActive={false} type="monotone" dataKey="range" name="80% range" stroke="none" fill={SERIES.primary} fillOpacity={0.15} />
          <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual demand" stroke={SERIES.secondary} strokeWidth={2} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="forecast" name="Forecast" stroke={SERIES.primary} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-3 text-xs text-gray-600">
        Method: {d.method} (alpha {d.alpha}, {d.history_months} months of history, {title}). Back-test on the last {b.months} known months:
        average error <b className="text-gray-900">{fmtNum(b.mae, 0)} units</b>{b.mape_pct != null && <> (<b className="text-gray-900">{b.mape_pct}%</b>)</>};
        the simple 3-month-average baseline had {fmtNum(b.naive_mae, 0)}.{' '}
        {b.beats_baseline ? 'The model was more accurate than the baseline.' : 'The model was not more accurate than the baseline for this item, so treat it with caution.'}
      </p>
    </div>
  )
}

// Connects the forecast to inventory planning (services/planning.py on the backend).
function InventoryPlanLink() {
  const d = useApi('/api/decision/demand-plan')
  if (d.loading && !d.data) return <Loading />
  if (d.error) return <ErrorBanner message={d.error} onRetry={d.reload} />
  return (
    <>
      <p className="mb-3 text-sm text-gray-600">For every stocked product: the next-month forecast rate is compared with the historical rate used for its reorder level.
        Planning uses the <b>higher</b> of the two. Gap &gt; +20% = High demand risk, &gt; +5% = Medium. {d.data.without_forecast} stocked product(s) have too little history for a forecast and use the historical rate.</p>
      <Table rowKey="inventory_id" rows={d.data.items} maxHeight={420} columns={[
        { key: 'product_name', label: 'Product / warehouse', render: (p) => <div><p className="max-w-64 truncate font-medium text-gray-900">{p.product_name}</p><p className="text-xs text-gray-500">{p.warehouse}</p></div> },
        { key: 'fc', label: 'Forecast next 3 months (units)', render: (p) => <span className="text-xs">{(p.forecast_months || []).map((m) => `${m.month}: ${fmtNum(m.forecast)}`).join(' · ')}</span> },
        { key: 'historical_daily', label: 'Historical / day', align: 'right', render: (p) => fmtNum(p.historical_daily, 2) },
        { key: 'forecast_daily', label: 'Forecast / day', align: 'right', render: (p) => fmtNum(p.forecast_daily, 2) },
        { key: 'gap_pct', label: 'Gap', align: 'right', render: (p) => (p.gap_pct == null ? '-' : `${p.gap_pct > 0 ? '+' : ''}${p.gap_pct}%`) },
        { key: 'demand_risk', label: 'Demand risk', render: (p) => <RiskBadge level={p.demand_risk} /> },
        { key: 'stockout_risk', label: 'Stockout risk', render: (p) => <RiskBadge level={p.stockout_risk} /> },
        { key: 'replenishment_qty', label: 'Replenish qty', align: 'right', render: (p) => (p.replenishment_qty ? <Link to="/purchase-orders" className="font-semibold text-accent hover:underline">{fmtNum(p.replenishment_qty)}</Link> : '-') },
      ]} />
    </>
  )
}

export default function Demand() {
  const [period, setPeriod] = useState('consistent')
  const overview = useApi(`/api/demand/overview?period=${period}`)
  const products = useApi(`/api/demand/products?period=${period}`)
  const [productId, setProductId] = useState('')
  const [search, setSearch] = useState('')
  const detail = useApi(productId ? `/api/demand/products/${productId}?period=${period}` : null)

  useEffect(() => { if (!productId && products.data?.length) setProductId(String(products.data[0].product_id)) }, [products.data, productId])
  const filtered = useMemo(() => (products.data || []).filter((p) => !search || `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase())), [products.data, search])

  const o = overview.data
  return (
    <div>
      <PageHeader title="Demand Analysis & Forecasting" description="Historical demand, trend analysis and short-term demand forecasts (exponential smoothing - a statistical method, not a trained ML model) from real DataCo order records, linked to inventory planning."
        actions={<Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-64"
          options={[{ value: 'consistent', label: 'Consistent period (Jan 2015 - Sep 2017)' }, { value: 'all', label: 'All data (Jan 2015 - Jan 2018)' }]} />} />
      <ErrorBanner message={overview.error} onRetry={overview.reload} />
      {!o ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Units ordered" value={fmtNum(o.totals.quantity)} />
            <StatCard label="Sales revenue" value={`$${fmtNum(o.totals.sales / 1e6, 1)}M`} />
            <StatCard label="Orders" value={fmtNum(o.totals.orders)} />
            <StatCard label="Overall trend (12 mo.)" value={o.trend.direction} hint={`${o.trend.pct_per_month > 0 ? '+' : ''}${o.trend.pct_per_month}% of mean per month`} />
          </div>
          {period === 'all' && <p className="mt-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-800">{o.note}</p>}

          <Card className="mt-6" title="Monthly demand - all products" subtitle={<TrendText t={o.trend} />}><DemandChart data={o.months} /></Card>

          <Card className="mt-6" title="Demand forecast - next 3 months (all products)" subtitle="Always based on the consistent period (Jan 2015 - Sep 2017)">
            <ForecastPanel url="/api/demand/forecast?horizon=3" history={o.months} title="all products" />
          </Card>

          <Card className="mt-6" title="Forecast → inventory planning" subtitle="How the demand forecast feeds reorder decisions (statistical forecast + rule-based planning)"><InventoryPlanLink /></Card>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card title="Top 10 products by units">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={o.top_products.map((p) => ({ ...p, short: p.name.length > 26 ? `${p.name.slice(0, 26)}…` : p.name }))} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f0f0ef" horizontal={false} />
                  <XAxis type="number" {...axisProps} />
                  <YAxis type="category" dataKey="short" {...axisProps} width={170} tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip formatter={(v) => fmtNum(v)} />} cursor={{ fill: '#f9fafb' }} />
                  <Bar isAnimationActive={false} dataKey="quantity" name="Units" fill={SERIES.primary} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Top 10 categories by sales ($)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={o.categories} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f0f0ef" horizontal={false} />
                  <XAxis type="number" {...axisProps} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                  <YAxis type="category" dataKey="category" {...axisProps} width={140} tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip formatter={(v) => `$${fmtNum(v)}`} />} cursor={{ fill: '#f9fafb' }} />
                  <Bar isAnimationActive={false} dataKey="sales" name="Sales" fill={SERIES.primary} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}

      <Card className="mt-6" title="Product demand history"
        actions={products.data && <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-80"
          options={products.data.map((p) => ({ value: String(p.product_id), label: `${p.name} (#${p.product_id})` }))} />}>
        {!productId || detail.loading ? <Loading /> : detail.error ? <ErrorBanner message={detail.error} /> : detail.data && (
          <>
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>Category: <b className="text-gray-900">{detail.data.product.category}</b></span>
              <span>Avg. daily demand: <b className="text-gray-900">{detail.data.product.avg_daily_demand}</b> units</span>
              <span>Trend: <TrendText t={detail.data.trend} /></span>
            </div>
            {detail.data.months.length ? <DemandChart data={detail.data.months} height={260} /> : <p className="text-sm text-gray-500">No orders for this product in the selected period.</p>}
            <h3 className="mb-3 mt-6 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-900">Forecast for this product - next 3 months</h3>
            <ForecastPanel url={`/api/demand/forecast/${productId}?horizon=3`} history={detail.data.months} title="this product" />
          </>
        )}
      </Card>

      <Card className="mt-6" title="All products" subtitle="Click a product to view its history" actions={<Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />}>
        <ErrorBanner message={products.error} onRetry={products.reload} />
        {products.loading ? <Loading /> : (
          <Table rowKey="product_id" maxHeight={420} rows={filtered} columns={[
            { key: 'name', label: 'Product', render: (p) => <button className="font-medium text-accent hover:underline" onClick={() => { setProductId(String(p.product_id)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{p.name}</button> },
            { key: 'category', label: 'Category' },
            { key: 'quantity', label: 'Units', align: 'right', render: (p) => fmtNum(p.quantity) },
            { key: 'sales', label: 'Sales ($)', align: 'right', render: (p) => fmtNum(p.sales) },
            { key: 'avg_daily_demand', label: 'Avg/day', align: 'right' },
            { key: 'active_months', label: 'Months', align: 'right' },
            { key: 'last_month', label: 'Last order' },
            { key: 'trend', label: 'Trend (12 mo.)' },
          ]} />
        )}
      </Card>
    </div>
  )
}
