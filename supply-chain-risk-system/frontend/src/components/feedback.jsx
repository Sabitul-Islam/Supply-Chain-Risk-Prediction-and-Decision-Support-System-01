// App-wide feedback: confirmation dialogs (useConfirm) and success / error notifications (useToast).
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import Icon from './icons.jsx'
import { Button, Modal } from './ui.jsx'

const Ctx = createContext(null)

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [toasts, setToasts] = useState([])
  const resolver = useRef(null)
  const nextId = useRef(1)

  // confirm('text') or confirm({ title, message, confirmLabel, danger }) -> Promise<boolean>
  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve
    setDialog(typeof opts === 'string' ? { message: opts } : opts)
  }), [])
  const close = useCallback((result) => { resolver.current?.(result); resolver.current = null; setDialog(null) }, [])
  const cancel = useCallback(() => close(false), [close])

  const toast = useCallback((message, type = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 7000 : 4500)
  }, [])

  return (
    <Ctx.Provider value={{ confirm, toast }}>
      {children}
      <Modal open={!!dialog} title={dialog?.title || 'Please confirm'} onClose={cancel}>
        <p className="text-sm text-gray-700">{dialog?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel}>Cancel</Button>
          <Button variant={dialog?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{dialog?.confirmLabel || 'Confirm'}</Button>
        </div>
      </Modal>
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${t.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-white text-gray-800'}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.type === 'error' ? 'bg-risk-high' : 'bg-risk-low'}`} />
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss"><Icon name="close" className="h-4 w-4 text-gray-400" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useConfirm = () => useContext(Ctx).confirm
export const useToast = () => useContext(Ctx).toast
