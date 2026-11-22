import Icon from '../components/icons.jsx'

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white"><Icon name="demand" /></div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-sm text-gray-500">{footer}</p>
        <p className="mt-8 text-center text-xs text-gray-400">Supply Chain Risk Prediction and Decision Support System</p>
      </div>
    </div>
  )
}
