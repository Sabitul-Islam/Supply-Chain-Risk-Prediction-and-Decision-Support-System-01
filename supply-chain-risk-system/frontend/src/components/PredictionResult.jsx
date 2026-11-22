import { fmtPct } from '../services/api.js'
import { RiskBadge } from './ui.jsx'

export default function PredictionResult({ result, positiveLabel, negativeLabel, probabilityLabel }) {
  if (!result) return <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">Submit the form to get a prediction from the trained Random Forest model.</div>
  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-5">
      <div>
        <p className="text-sm text-gray-500">{probabilityLabel}</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-gray-900">{fmtPct(result.probability)}</p>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.round(result.probability * 100)}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-500">Risk level</span><RiskBadge level={result.risk_level} />
        <span className="ml-2 text-gray-500">Prediction</span>
        <span className="font-medium text-gray-900">{result.prediction ? positiveLabel : negativeLabel}</span>
      </div>
      <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><p className="mb-1 font-medium text-gray-900">Recommendation</p>{result.recommendation}</div>
      <p className="text-xs text-gray-400">Saved to Prediction History.</p>
    </div>
  )
}
