import { Component } from 'react'

/**
 * Last line of defence: a rendering error in any screen used to blank the whole app with no way
 * out. This shows a short message and a reload button instead; stock data is never touched.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('UI error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm text-slate-500">
            Nothing was lost – your stock records are safe on the server. Reload the page to continue.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn-secondary" onClick={() => window.location.assign('/')}>Go to dashboard</button>
          </div>
        </div>
      </div>
    )
  }
}
