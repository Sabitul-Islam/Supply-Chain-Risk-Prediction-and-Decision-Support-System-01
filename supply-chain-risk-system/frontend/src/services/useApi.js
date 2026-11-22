import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

// Fetch-on-mount hook with loading / error / reload.
export function useApi(path) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!path) return
    setLoading(true); setError('')
    try { setData(await api(path)) } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [path])
  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load, setData }
}
