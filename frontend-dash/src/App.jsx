import { useEffect, useState } from 'react'

const API = '/api'

const themes = {
  dark:  { bg: '#0f0f0f', surface: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', muted: '#888', up: '#22c55e', down: '#ef4444' },
  light: { bg: '#f9fafb', surface: '#fff',     border: '#e5e7eb', text: '#1a1a18', muted: '#6b7280', up: '#22c55e', down: '#ef4444' },
}

const StatusDot = ({ status, t }) => (
  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: status === 'up' ? t.up : status === 'down' ? t.down : t.border, marginRight: 8 }} />
)

export default function App() {
  const [health, setHealth]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode]       = useState('dark')

  const t = themes[mode]

  const fetchHealth = async () => {
    try {
      const res  = await fetch(`${API}/health`)
      const data = await res.json()
      setHealth(data)
    } catch {
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 600, margin: '0 auto', minHeight: '100vh', background: t.bg, color: t.text }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>RAG Platform</h1>
          <p style={{ color: t.muted }}>DevOps Dashboard</p>
        </div>
        <button onClick={() => setMode(m => m === 'dark' ? 'light' : 'dark')}
          style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: 'pointer', fontSize: 13 }}>
          {mode === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
      </div>

      <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Service Health</h2>

        {loading && <p style={{ color: t.muted }}>Checking services...</p>}

        {!loading && !health && <p style={{ color: t.down }}>⚠ Could not reach backend</p>}

        {health && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Backend',    status: health.status === 'ok' ? 'up' : 'down' },
              { label: 'PostgreSQL', status: health.postgres },
              { label: 'Ollama',     status: health.ollama },
            ].map(({ label, status }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', fontSize: 14 }}>
                <StatusDot status={status} t={t} />
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ color: status === 'up' ? t.up : t.down, fontWeight: 500 }}>{status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}