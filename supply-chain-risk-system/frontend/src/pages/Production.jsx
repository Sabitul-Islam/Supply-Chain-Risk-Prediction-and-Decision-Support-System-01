import { useMemo, useState } from 'react'
import CsvUpload from '../components/CsvUpload.jsx'
import ModelMetrics from '../components/ModelMetrics.jsx'
import PredictionResult from '../components/PredictionResult.jsx'
import { RiskBarChart } from '../components/charts.jsx'
import { Button, Card, ErrorBanner, Field, Input, Loading, PageHeader, ProbabilityBar, RiskBadge, Select, SuccessBanner, Table } from '../components/ui.jsx'
import { api } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const DEFAULTS = { machine_code: '', machine_type: 'M', air_temperature_k: '300.1', process_temperature_k: '310.2',
  rotational_speed_rpm: '1500', torque_nm: '40.0', tool_wear_min: '110', save_to_records: false }
const NUM_FIELDS = [
  ['air_temperature_k', 'Air temperature (K)', '0.1', 'Typical 295-305 K'],
  ['process_temperature_k', 'Process temperature (K)', '0.1', 'Typical 305-314 K'],
  ['rotational_speed_rpm', 'Rotational speed (rpm)', '1', 'Typical 1,150-2,900 rpm'],
  ['torque_nm', 'Torque (Nm)', '0.1', 'Typical 4-77 Nm'],
  ['tool_wear_min', 'Tool wear (min)', '1', 'Typical 0-250 min'],
]

export default function Production() {
  const machines = useApi('/api/machines')
  const [form, setForm] = useState(DEFAULTS)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [rowBusy, setRowBusy] = useState(null)
  const [filter, setFilter] = useState('')

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const predict = async (e) => {
    e.preventDefault()
    const body = { ...form, machine_code: form.machine_code.trim() || null }
    for (const [k, label] of NUM_FIELDS) {
      if (form[k] === '' || Number.isNaN(Number(form[k]))) { setError(`${label} must be a number.`); return }
      body[k] = Number(form[k])
    }
    setBusy(true); setError('')
    try {
      setResult(await api('/api/machines/predict', { method: 'POST', body }))
      if (form.save_to_records) machines.reload()
    } catch (err) { setError(err.message); setResult(null) } finally { setBusy(false) }
  }

  const rowAction = async (m, action) => {
    if (action === 'delete' && !window.confirm(`Delete machine ${m.machine_code}?`)) return
    setRowBusy(`${action}-${m.id}`)
    try {
      if (action === 'delete') { await api(`/api/machines/${m.id}`, { method: 'DELETE' }); setMsg(`Machine ${m.machine_code} deleted.`) }
      else { const r = await api(`/api/machines/${m.id}/predict`, { method: 'POST' }); setMsg(`${m.machine_code}: failure probability ${(r.failure_probability * 100).toFixed(1)}% (${r.risk_level}).`) }
      machines.reload()
    } catch (err) { setError(err.message) } finally { setRowBusy(null) }
  }

  const rows = useMemo(() => (machines.data || []).filter((m) => !filter || m.risk_level === filter), [machines.data, filter])
  const dist = ['Low', 'Medium', 'High'].map((level) => ({ level, count: (machines.data || []).filter((m) => m.risk_level === level).length }))

  const columns = [
    { key: 'machine_code', label: 'Machine' },
    { key: 'machine_type', label: 'Type' },
    { key: 'air_temperature_k', label: 'Air K', align: 'right' },
    { key: 'process_temperature_k', label: 'Process K', align: 'right' },
    { key: 'rotational_speed_rpm', label: 'RPM', align: 'right' },
    { key: 'torque_nm', label: 'Torque Nm', align: 'right' },
    { key: 'tool_wear_min', label: 'Wear min', align: 'right' },
    { key: 'failure_probability', label: 'Failure prob.', render: (m) => <ProbabilityBar value={m.failure_probability} /> },
    { key: 'risk_level', label: 'Risk', render: (m) => <RiskBadge level={m.risk_level} /> },
    { key: 'actual_failure', label: 'Actual (dataset)', render: (m) => m.actual_failure == null ? <span className="text-gray-400">unknown</span> : m.actual_failure ? 'Failure' : 'No failure' },
    { key: 'recommendation', label: 'Maintenance recommendation', wrap: true, render: (m) => <span title={m.recommendation} className="line-clamp-2 w-80 whitespace-normal text-xs text-gray-600">{m.recommendation}</span> },
    { key: 'actions', label: '', render: (m) => (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon="refresh" loading={rowBusy === `predict-${m.id}`} onClick={() => rowAction(m, 'predict')} title="Re-run prediction" />
        <Button size="sm" variant="ghost" icon="trash" loading={rowBusy === `delete-${m.id}`} onClick={() => rowAction(m, 'delete')} title="Delete" />
      </div>) },
  ]

  return (
    <div>
      <PageHeader title="Production" description="Machine failure prediction using a Random Forest trained on the AI4I 2020 predictive maintenance dataset." />
      <SuccessBanner message={msg} onClose={() => setMsg('')} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Predict machine failure" subtitle="Enter current operating measurements" className="lg:col-span-3">
          <ErrorBanner message={error} />
          <form onSubmit={predict} className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Machine code (optional)"><Input value={form.machine_code} onChange={set('machine_code')} placeholder="M-1001" /></Field>
                <Field label="Product quality type">
                  <Select value={form.machine_type} onChange={set('machine_type')} options={[{ value: 'L', label: 'L - Low' }, { value: 'M', label: 'M - Medium' }, { value: 'H', label: 'H - High' }]} />
                </Field>
              </div>
              {NUM_FIELDS.map(([k, label, step, hint]) => (
                <Field key={k} label={label} hint={hint}><Input type="number" step={step} value={form[k]} onChange={set(k)} required /></Field>
              ))}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.save_to_records} onChange={set('save_to_records')} className="h-4 w-4 rounded border-gray-300 accent-[#2a78d6]" />
                Also save / update this machine in the records table
              </label>
              <div className="flex gap-2">
                <Button type="submit" loading={busy}>Predict</Button>
                <Button type="button" variant="secondary" onClick={() => { setForm(DEFAULTS); setResult(null); setError('') }}>Reset</Button>
              </div>
            </div>
            <PredictionResult result={result} positiveLabel="Failure expected" negativeLabel="No failure expected" probabilityLabel="Failure probability" />
          </form>
        </Card>
        <Card title="Machine risk distribution" className="lg:col-span-2">
          <RiskBarChart data={dist} name="Machines" height={230} />
          <p className="mt-3 text-xs text-gray-500">Risk levels: Low &lt; 20%, Medium 20-50%, High ≥ 50% failure probability. Seeded machines are unseen test-set records from AI4I 2020.</p>
        </Card>
      </div>

      <div className="mt-6"><ModelMetrics modelKey="machine_failure" title="Model comparison - Random Forest vs Logistic Regression" /></div>

      <Card className="mt-6" title="Machine records" subtitle="Sorted by failure probability"
        actions={<Select value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="All risk levels" options={['High', 'Medium', 'Low']} className="w-40" />}>
        <ErrorBanner message={machines.error} onRetry={machines.reload} />
        {machines.loading && !machines.data ? <Loading /> : <Table columns={columns} rows={rows} maxHeight={520} />}
      </Card>

      <Card className="mt-6" title="Batch prediction (CSV)" subtitle="Upload machine readings; each valid row is predicted, saved to machine records and to prediction history.">
        <CsvUpload uploadPath="/api/machines/upload" templatePath="/api/machines/template" templateName="machines_template.csv"
          onDone={() => machines.reload()} describe={(r) => `Predicted ${r.processed} machine(s), rejected ${r.rejected} row(s). High risk: ${r.results.filter((x) => x.risk_level === 'High').length}.`} />
      </Card>
    </div>
  )
}
