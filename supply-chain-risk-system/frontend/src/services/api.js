// Small fetch wrapper: adds the JWT, parses FastAPI errors into readable messages.
const TOKEN_KEY = 'scr_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

function errorMessage(data, status) {
  const d = data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map((e) => {
      const field = (e.loc || []).filter((x) => x !== 'body').join('.')
      const msg = (e.msg || '').replace(/^Value error, /, '')
      return field ? `${field.replace(/_/g, ' ')}: ${msg}` : msg
    }).join(' · ')
  }
  if (status === 0) return 'Cannot reach the server. Is the backend running on port 8000?'
  return `Request failed (${status})`
}

export async function api(path, { method = 'GET', body, form, raw } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  let res
  try {
    res = await fetch(path, { method, headers, body: payload })
  } catch {
    throw new Error(errorMessage(null, 0))
  }
  if (res.status === 401 && token) {
    setToken(null)
    window.dispatchEvent(new Event('auth:expired'))
  }
  if (raw && res.ok) return res
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new Error(errorMessage(data, res.status))
  return data
}

export async function downloadFile(path, filename) {
  const res = await api(path, { raw: true })
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function uploadCsv(path, file) {
  const form = new FormData()
  form.append('file', file)
  return api(path, { method: 'POST', form })
}

export const fmtPct = (p) => (p == null ? '-' : `${(p * 100).toFixed(1)}%`)
export const fmtNum = (n, d = 0) => (n == null ? '-' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }))
