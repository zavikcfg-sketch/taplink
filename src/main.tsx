import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    return { hasError: true, message: msg }
  }

  override componentDidCatch(error: unknown) {
    console.error('Root render error:', error)
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100svh',
            display: 'grid',
            placeItems: 'center',
            color: '#f8fafc',
            padding: '24px',
          }}
        >
          <div>
            <h1 style={{ margin: '0 0 10px', fontSize: '1.2rem' }}>Ошибка интерфейса</h1>
            <p style={{ margin: '0 0 8px', opacity: 0.8 }}>
              Обновите страницу. Если проблема повторяется — откройте <code>/</code>.
            </p>
            <p style={{ margin: 0, opacity: 0.8, fontSize: '0.9rem' }}>
              Детали: <code>{this.state.message || 'unknown_error'}</code>
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
)
