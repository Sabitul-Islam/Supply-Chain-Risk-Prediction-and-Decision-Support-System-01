import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip, SERIES, axisProps, gridProps } from '../components/charts.jsx'
import { Card, ErrorBanner, Input, Loading, PageHeader, Select, StatCard, Table } from '../components/ui.jsx'
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
      <PageHeader title="Demand Analysis" description="Product-wise historical demand and trend analysis from real DataCo order records."
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
