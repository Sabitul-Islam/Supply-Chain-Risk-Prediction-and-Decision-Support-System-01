import { useEffect, useRef, useState } from 'react'
import Icon from '../components/icons.jsx'
import { Button, Card, PageHeader, Spinner } from '../components/ui.jsx'
import { api } from '../services/api.js'
import { useApi } from '../services/useApi.js'

const TYPE_LABEL = { live_data: 'Live database', documentation: 'Documentation', fallback: 'No match' }

export default function Assistant() {
  const suggestions = useApi('/api/assistant/suggestions')
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'Hi! Ask me about the system, the risk calculations, the ML models, or live data such as "Which suppliers are high risk?"' }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef()
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [messages, busy])

  const ask = async (q) => {
    const question = (q ?? input).trim()
    if (question.length < 2 || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const r = await api('/api/assistant/ask', { method: 'POST', body: { question } })
      setMessages((m) => [...m, { role: 'assistant', text: r.answer, type: r.type, sources: r.sources }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${e.message}`, type: 'error' }])
    } finally { setBusy(false) }
  }

  return (
    <div>
      <PageHeader title="AI Assistant" description="Lightweight project assistant: answers from the project documentation (TF-IDF retrieval) and from live database queries. No external AI service is used." />
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <div className="flex h-[60vh] min-h-96 flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-accent text-white' : m.type === 'error' ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-gray-200 bg-gray-50 text-gray-800'}`}>
                    <p className="whitespace-pre-line">{m.text}</p>
                    {m.type && m.type !== 'error' && (
                      <p className="mt-2 text-xs text-gray-500">{TYPE_LABEL[m.type]}{m.sources?.length ? ` · ${m.sources.join(', ')}` : ''}</p>
                    )}
                  </div>
                </div>
              ))}
              {busy && <div className="flex items-center gap-2 text-sm text-gray-500"><Spinner className="h-4 w-4" />Thinking...</div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); ask() }} className="mt-4 flex gap-2 border-t border-gray-200 pt-4">
              <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="Ask a question..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
              <Button type="submit" loading={busy} disabled={input.trim().length < 2}><Icon name="send" className="h-4 w-4" />Send</Button>
            </form>
          </div>
        </Card>
        <Card title="Try asking">
          <div className="flex flex-col gap-2">
            {(suggestions.data || []).map((s) => (
              <button key={s} onClick={() => ask(s)} disabled={busy}
                className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 hover:border-accent hover:bg-accent-light/40 disabled:opacity-60">{s}</button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
