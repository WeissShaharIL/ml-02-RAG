import { useEffect, useState, useRef } from 'react'

const API = '/api'

const themes = {
  dark:  { bg: '#0f0f0f', surface: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', muted: '#888', up: '#22c55e', down: '#ef4444', inputBg: '#111', logBg: '#0a0a0a' },
  light: { bg: '#f9fafb', surface: '#fff',     border: '#e5e7eb', text: '#1a1a18', muted: '#6b7280', up: '#22c55e', down: '#ef4444', inputBg: '#fff', logBg: '#f0f0ee' },
}

// Color per service — consistent across themes
const SERVICE_COLORS = {
  backend:  '#60a5fa',  // blue
  ollama:   '#facc15',  // yellow
  postgres: '#4ade80',  // green
}

const StatusDot = ({ status, t }) => (
  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: status === 'up' ? t.up : status === 'down' ? t.down : t.border, marginRight: 8 }} />
)

const MAX_LINES = 500

export default function App() {
  const [health, setHealth]       = useState(null)
  const [pages, setPages]         = useState([])
  const [mode, setMode]           = useState('dark')
  const [tab, setTab]             = useState('url')
  const [url, setUrl]             = useState('')
  const [title, setTitle]         = useState('')
  const [text, setText]           = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [message, setMessage]     = useState(null)
  const [confirmId, setConfirmId] = useState(null)
  const [deleting, setDeleting]   = useState(null)

  // Logs state
  const [logLines, setLogLines]     = useState([])
  const [logPaused, setLogPaused]   = useState(false)
  const [logFilter, setLogFilter]   = useState('all')  // 'all' | 'backend' | 'ollama' | 'postgres'
  const [logConnected, setLogConnected] = useState(false)
  const logBottomRef  = useRef(null)
  const logPausedRef  = useRef(false)    // ref so SSE handler sees current value
  const esRef         = useRef(null)     // EventSource ref

  const t = themes[mode]

  // Keep ref in sync with state
  useEffect(() => { logPausedRef.current = logPaused }, [logPaused])

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API}/health`)
      setHealth(await res.json())
    } catch { setHealth(null) }
  }

  const fetchPages = async () => {
    try {
      const res = await fetch(`${API}/pages`)
      setPages(await res.json())
    } catch { setPages([]) }
  }

  // ── Log streaming ────────────────────────────────────────────────────────────
  const connectLogs = () => {
    if (esRef.current) esRef.current.close()

    const es = new EventSource(`${API}/logs/stream`)
    esRef.current = es

    es.onopen = () => setLogConnected(true)

    es.onmessage = (e) => {
      if (logPausedRef.current) return
      try {
        const { service, line } = JSON.parse(e.data)
        setLogLines(prev => {
          const next = [...prev, { service, line, id: Date.now() + Math.random() }]
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
        })
      } catch {}
    }

    es.onerror = () => {
      setLogConnected(false)
      es.close()
      // Reconnect after 3s
      setTimeout(connectLogs, 3000)
    }
  }

  useEffect(() => {
    fetchHealth()
    fetchPages()
    connectLogs()
    const interval = setInterval(() => { fetchHealth(); fetchPages() }, 10000)
    return () => {
      clearInterval(interval)
      if (esRef.current) esRef.current.close()
    }
  }, [])

  // Auto-scroll log window
  useEffect(() => {
    if (!logPaused) {
      logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logLines, logPaused])

  // ── Ingest ───────────────────────────────────────────────────────────────────
  const ingestURL = async () => {
    if (!url.trim()) return
    setIngesting(true)
    setMessage(null)
    try {
      const res  = await fetch(`${API}/ingest/url`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'success', text: `✓ Ingested "${data.title}" — ${data.chunks} chunks` })
      setUrl('')
      fetchPages()
    } catch (e) {
      setMessage({ type: 'error', text: `✗ ${e.message}` })
    } finally { setIngesting(false) }
  }

  const ingestText = async () => {
    if (!title.trim() || !text.trim()) return
    setIngesting(true)
    setMessage(null)
    try {
      const res  = await fetch(`${API}/ingest/text`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: title.trim(), text: text.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'success', text: `✓ Ingested "${data.title}" — ${data.chunks} chunks` })
      setTitle('')
      setText('')
      fetchPages()
    } catch (e) {
      setMessage({ type: 'error', text: `✗ ${e.message}` })
    } finally { setIngesting(false) }
  }

  const deletePage = async (id) => {
    setDeleting(id)
    setConfirmId(null)
    try {
      const res = await fetch(`${API}/pages/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setPages(prev => prev.filter(p => p.id !== id))
    } catch (e) {
      setMessage({ type: 'error', text: `✗ ${e.message}` })
    } finally { setDeleting(null) }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const card  = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }
  const input = { width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, background: t.inputBg, color: t.text, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }
  const btn   = (disabled) => ({ padding: '10px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 })

  const visibleLines = logFilter === 'all'
    ? logLines
    : logLines.filter(l => l.service === logFilter)

  return (
    <div style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 700, margin: '0 auto', minHeight: '100vh', background: t.bg, color: t.text }}>

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

      {/* Health */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Service Health</h2>
        {!health && <p style={{ color: t.muted }}>Checking...</p>}
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

      {/* Ingest */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Ingest Knowledge</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['url', 'text'].map(t2 => (
            <button key={t2} onClick={() => setTab(t2)}
              style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: tab === t2 ? '#2563eb' : t.surface, color: tab === t2 ? '#fff' : t.text, cursor: 'pointer', fontSize: 13 }}>
              {t2 === 'url' ? '🔗 URL' : '📝 Paste Text'}
            </button>
          ))}
        </div>
        {tab === 'url' && (
          <div>
            <input value={url} onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ingestURL()}
              placeholder="https://en.wikipedia.org/wiki/Space_exploration"
              style={input} />
            <button onClick={ingestURL} disabled={ingesting || !url.trim()} style={btn(ingesting || !url.trim())}>
              {ingesting ? 'Ingesting...' : 'Ingest URL'}
            </button>
          </div>
        )}
        {tab === 'text' && (
          <div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={input} />
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="Paste your text here..."
              style={{ ...input, height: 150, resize: 'vertical', fontFamily: 'inherit' }} />
            <button onClick={ingestText} disabled={ingesting || !title.trim() || !text.trim()} style={btn(ingesting || !title.trim() || !text.trim())}>
              {ingesting ? 'Ingesting...' : 'Ingest Text'}
            </button>
          </div>
        )}
        {message && (
          <p style={{ marginTop: 12, fontSize: 13, color: message.type === 'success' ? t.up : t.down }}>
            {message.text}
          </p>
        )}
      </div>

      {/* Knowledge Base */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Knowledge Base ({pages.length} pages)</h2>
        {pages.length === 0 && <p style={{ color: t.muted, fontSize: 14 }}>No pages ingested yet.</p>}
        {pages.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '10px 0', borderBottom: `1px solid ${t.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
              <div style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{new Date(p.created_at).toLocaleDateString()}</div>
            </div>
            {confirmId === p.id ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: t.muted }}>Delete?</span>
                <button onClick={() => deletePage(p.id)}
                  style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Yes</button>
                <button onClick={() => setConfirmId(null)}
                  style={{ padding: '4px 10px', background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>No</button>
              </div>
            ) : (
              <button onClick={() => setConfirmId(p.id)} disabled={deleting === p.id}
                style={{ padding: '4px 10px', background: 'transparent', color: t.muted, border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer', flexShrink: 0, opacity: deleting === p.id ? 0.4 : 1 }}>
                {deleting === p.id ? '…' : '🗑 Delete'}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Live Logs */}
      <div style={card}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 500 }}>Live Logs</h2>
            <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: logConnected ? '#16a34a22' : '#dc262622', color: logConnected ? t.up : t.down }}>
              {logConnected ? '● live' : '○ reconnecting'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setLogPaused(p => !p)}
              style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: logPaused ? '#2563eb' : t.surface, color: logPaused ? '#fff' : t.text, fontSize: 12, cursor: 'pointer' }}>
              {logPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button onClick={() => setLogLines([])}
              style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface, color: t.muted, fontSize: 12, cursor: 'pointer' }}>
              Clear
            </button>
          </div>
        </div>

        {/* Service filter */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['all', 'backend', 'ollama', 'postgres'].map(f => (
            <button key={f} onClick={() => setLogFilter(f)}
              style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                border: `1px solid ${logFilter === f ? (SERVICE_COLORS[f] || t.border) : t.border}`,
                background: logFilter === f ? (SERVICE_COLORS[f] ? SERVICE_COLORS[f] + '22' : t.surface) : 'transparent',
                color: logFilter === f ? (SERVICE_COLORS[f] || t.text) : t.muted,
              }}>
              {f}
            </button>
          ))}
        </div>

        {/* Log window */}
        <div style={{
          height: 320, overflowY: 'auto', background: t.logBg,
          borderRadius: 8, border: `1px solid ${t.border}`,
          padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6,
        }}>
          {visibleLines.length === 0 && (
            <span style={{ color: t.muted }}>Waiting for logs...</span>
          )}
          {visibleLines.map(({ id, service, line }) => (
            <div key={id} style={{ display: 'flex', gap: 8, wordBreak: 'break-all' }}>
              <span style={{ color: SERVICE_COLORS[service], flexShrink: 0, userSelect: 'none' }}>[{service}]</span>
              <span style={{ color: t.text }}>{line}</span>
            </div>
          ))}
          <div ref={logBottomRef} />
        </div>

        {logPaused && (
          <p style={{ fontSize: 12, color: t.muted, marginTop: 6 }}>
            ⏸ Paused — {logLines.length} lines buffered. New lines are still collected.
          </p>
        )}
      </div>

    </div>
  )
}