import { useEffect, useState } from 'react'
import { Button, Card, ErrorBanner, Loading, Modal, PageHeader, Pagination, ProbabilityBar, RiskBadge, Select, SuccessBanner, Table } from '../components/ui.jsx'
import { api } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const MODEL_LABEL = { machine_failure: 'Machine failure', late_delivery: 'Late delivery' }

export default function History() {
  const [model, setModel] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useApi(`/api/history?page=${page}&page_size=20${model ? `&model=${model}` : ''}`)
  const [view, setView] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(null)
  useEffect(() => { setPage(1) }, [model])

  const remove = async (id) => {
    setBusy(id)
    try { await api(`/api/history/${id}`, { method: 'DELETE' }); setMsg('Entry deleted.'); reload() } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const clearAll = async () => {
    if (!window.confirm('Delete your entire prediction history?')) return
    setBusy('all')
    try { const r = await api('/api/history', { method: 'DELETE' }); setMsg(r.detail); setPage(1); reload() } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHeader title="Prediction History" description="Every machine-failure and late-delivery prediction you have made (manual or CSV)."
        actions={<Button variant="danger" icon="trash" onClick={clearAll} loading={busy === 'all'} disabled={!data?.total}>Clear history</Button>} />
      <SuccessBanner message={msg} onClose={() => setMsg('')} />
      <ErrorBanner message={err || error} onRetry={error ? reload : undefined} />
      <Card title="Predictions" actions={<Select value={model} onChange={(e) => setModel(e.target.value)} placeholder="All models" className="w-48"
        options={[{ value: 'machine_failure', label: 'Machine failure' }, { value: 'late_delivery', label: 'Late delivery' }]} />}>
        {loading && !data ? <Loading /> : data && (
          <>
            <Table rows={data.items} empty="No predictions yet. Make one on the Production or Transportation page." columns={[
              { key: 'created_at', label: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
              { key: 'model_name', label: 'Model', render: (r) => MODEL_LABEL[r.model_name] },
              { key: 'source', label: 'Source', render: (r) => <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs uppercase text-gray-600">{r.source}</span> },
              { key: 'subject', label: 'Subject', render: (r) => r.input.machine_code || r.input.order_id || (r.input.shipping_mode ? `${r.input.shipping_mode} · ${r.input.market}` : `Type ${r.input.machine_type}`) },
              { key: 'probability', label: 'Probability', render: (r) => <ProbabilityBar value={r.probability} /> },
              { key: 'prediction', label: 'Prediction', render: (r) => r.model_name === 'machine_failure' ? (r.prediction ? 'Failure' : 'No failure') : (r.prediction ? 'Late' : 'On time') },
              { key: 'risk_level', label: 'Risk', render: (r) => <RiskBadge level={r.risk_level} /> },
              { key: 'actions', label: '', render: (r) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setView(r)}>Details</Button>
                  <Button size="sm" variant="ghost" icon="trash" loading={busy === r.id} onClick={() => remove(r.id)} title="Delete" />
                </div>) },
            ]} />
            {data.total > 0 && <Pagination page={page} pageSize={20} total={data.total} onChange={setPage} />}
          </>
        )}
      </Card>
      <Modal open={!!view} onClose={() => setView(null)} title="Prediction details">
        {view && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3"><RiskBadge level={view.risk_level} /><span className="text-gray-600">{MODEL_LABEL[view.model_name]} · {(view.probability * 100).toFixed(1)}%</span></div>
            <p className="rounded-lg bg-gray-50 p-3 text-gray-700">{view.recommendation}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {Object.entries(view.input).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-gray-500">{k.replace(/_/g, ' ')}</dt><dd className="text-right font-medium text-gray-900">{String(v)}</dd></div>
              ))}
            </dl>
          </div>
        )}
      </Modal>
    </div>
  )
}
