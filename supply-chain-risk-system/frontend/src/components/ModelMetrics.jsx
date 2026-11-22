import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../services/useApi.js'
import { ChartTooltip, SERIES, axisProps } from './charts.jsx'
import { Card, ErrorBanner, Loading } from './ui.jsx'

const NAMES = { random_forest: 'Random Forest (used)', logistic_regression: 'Logistic Regression' }
const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'roc_auc']

// Shows real hold-out metrics from data/models/metrics.json (written by the training script).
export default function ModelMetrics({ modelKey, title }) {
  const { data, loading, error, reload } = useApi('/api/models/metrics')
  if (loading) return <Card title={title}><Loading /></Card>
  if (error) return <Card title={title}><ErrorBanner message={error} onRetry={reload} /></Card>
  const m = data[modelKey]
  const cm = m.models.random_forest.confusion_matrix
  const pretty = (f) => f.replace(/^(shipping_mode|payment_type|machine_type|market|order_region|category_name|department_name|customer_segment)_(.+)$/, (_, a, b) => `${a.replace(/_name$/, '').replace(/_/g, ' ')}: ${b}`).replace(/_/g, ' ')
  const importance = m.feature_importance.slice(0, 8).map((f) => ({ feature: pretty(f.feature), importance: +(f.importance * 100).toFixed(1) }))

  return (
    <Card title={title} subtitle={`${m.split} · ${m.train_rows.toLocaleString()} train / ${m.test_rows.toLocaleString()} test rows · positive rate ${(m.positive_rate * 100).toFixed(1)}% · trained ${new Date(data.trained_at).toLocaleString()}`}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-3 py-2 text-left">Model</th>{METRICS.map((k) => <th key={k} className="px-3 py-2 text-right">{k === 'roc_auc' ? 'ROC-AUC' : k === 'f1' ? 'F1' : k}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Object.entries(m.models).map(([k, r]) => (
                  <tr key={k} className={k === 'random_forest' ? 'bg-accent-light/40' : ''}>
                    <td className="px-3 py-2 font-medium text-gray-800">{NAMES[k]}</td>
                    {METRICS.map((x) => <td key={x} className="px-3 py-2 text-right tabular-nums">{r[x].toFixed(3)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Random Forest confusion matrix (test set)</p>
              <table className="w-full text-center text-sm">
                <thead><tr className="text-xs text-gray-500"><th></th><th className="pb-1">Pred. 0</th><th className="pb-1">Pred. 1</th></tr></thead>
                <tbody>
                  <tr><td className="pr-2 text-left text-xs text-gray-500">Actual 0</td><td className="rounded border border-gray-200 bg-gray-50 py-2 tabular-nums">{cm.tn.toLocaleString()}</td><td className="rounded border border-gray-200 py-2 tabular-nums">{cm.fp.toLocaleString()}</td></tr>
                  <tr><td className="pr-2 text-left text-xs text-gray-500">Actual 1</td><td className="rounded border border-gray-200 py-2 tabular-nums">{cm.fn.toLocaleString()}</td><td className="rounded border border-gray-200 bg-gray-50 py-2 tabular-nums">{cm.tp.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-500">
              <p className="mb-1 text-sm font-medium text-gray-700">Excluded inputs</p>
              {Object.entries(m.excluded).map(([k, v]) => <p key={k} className="mb-1"><span className="font-medium text-gray-600">{k.replace(/_/g, ' ')}:</span> {v.join(', ')}</p>)}
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Top feature importance (RF, %)</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={importance} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f0f0ef" horizontal={false} />
              <XAxis type="number" {...axisProps} />
              <YAxis type="category" dataKey="feature" {...axisProps} width={175} tick={{ fill: '#6b7280', fontSize: 11 }} />
              <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: '#f9fafb' }} />
              <Bar isAnimationActive={false} dataKey="importance" name="Importance" fill={SERIES.primary} radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}
