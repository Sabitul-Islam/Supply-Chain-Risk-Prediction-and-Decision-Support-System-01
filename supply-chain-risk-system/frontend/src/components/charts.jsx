import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export const RISK_COLORS = { Low: '#0ca30c', Medium: '#ec835a', High: '#d03b3b' }
export const SERIES = { primary: '#2a78d6', secondary: '#52514e' }
export const axisProps = { tick: { fill: '#6b7280', fontSize: 12 }, axisLine: { stroke: '#e5e7eb' }, tickLine: false }
export const gridProps = { stroke: '#f0f0ef', vertical: false }

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      {label != null && <p className="mb-1 font-medium text-gray-800">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-gray-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          {p.name}: <span className="font-medium text-gray-900">{formatter ? formatter(p.value, p) : p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

// Low / Medium / High counts. Categories are labelled on the axis and values are direct-labelled,
// so identity never depends on colour alone.
export function RiskBarChart({ data, height = 200, name = 'Records' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="level" {...axisProps} />
        <YAxis allowDecimals={false} {...axisProps} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
        <Bar isAnimationActive={false} dataKey="count" name={name} radius={[4, 4, 0, 0]} maxBarSize={56}>
          {data.map((d) => <Cell key={d.level} fill={RISK_COLORS[d.level]} />)}
          <LabelList dataKey="count" position="top" fill="#374151" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
