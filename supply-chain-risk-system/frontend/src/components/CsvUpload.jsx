import { useRef, useState } from 'react'
import { downloadFile, uploadCsv } from '../services/api.js'
import { Button, ErrorBanner } from './ui.jsx'

// Reusable CSV upload: template download, client-side checks, server validation report.
export default function CsvUpload({ uploadPath, templatePath, templateName, onDone, describe }) {
  const ref = useRef()
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const pick = (e) => {
    const f = e.target.files?.[0]
    setResult(null)
    setError('')
    if (f && !f.name.toLowerCase().endsWith('.csv')) { setError('Please choose a .csv file.'); setFile(null); return }
    if (f && f.size > 5 * 1024 * 1024) { setError('File is larger than 5 MB.'); setFile(null); return }
    setFile(f || null)
  }

  const submit = async () => {
    if (!file) { setError('Choose a CSV file first.'); return }
    setBusy(true); setError('')
    try {
      const res = await uploadCsv(uploadPath, file)
      setResult(res)
      setFile(null)
      if (ref.current) ref.current.value = ''
      onDone?.(res)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const template = async () => {
    try { await downloadFile(templatePath, templateName) } catch (e) { setError(e.message) }
  }

  return (
    <div>
      <ErrorBanner message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" accept=".csv,text/csv" onChange={pick}
          className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50" />
        <Button icon="upload" onClick={submit} loading={busy} disabled={!file}>Upload & validate</Button>
        <Button variant="secondary" icon="download" onClick={template}>Template</Button>
      </div>
      {result && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="font-medium text-gray-800">{describe ? describe(result) : `Created ${result.created}, updated ${result.updated}, rejected ${result.rejected}.`}</p>
          {result.errors?.length > 0 && (
            <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-auto pl-5 text-red-700">
              {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
