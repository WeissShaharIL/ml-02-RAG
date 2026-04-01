import { useEffect, useState, useRef } from 'react'

const API = '/api'

const themes = {
  dark:  { bg: '#0f0f0f', surface: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', muted: '#888', userBg: '#2563eb', userText: '#fff', modelBg: '#1e1e1e', statusColor: '#facc15' },
  light: { bg: '#f5f5f3', surface: '#fff',     border: '#e0dfd8', text: '#1a1a18', muted: '#73726c', userBg: '#1a1a18', userText: '#f5f5f3', modelBg: '#fff', statusColor: '#d97706' },
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [ready, setReady]       = useState(false)
  const [mode, setMode]         = useState('dark')
  const bottomRef               = useRef(null)

  const t = themes[mode]

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setReady(d.status === 'ok'))
      .catch(() => setReady(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setLoading(true)

    // Add user message
    setMessages(prev => [...prev, { role: 'user', text: q }])

    // Add empty model message we'll update live
    const modelIdx = Date.now()
    setMessages(prev => [...prev, { role: 'model', id: modelIdx, status: 'Rewriting query...', text: '' }])

    try {
      const res = await fetch(`${API}/ask`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ''

      const updateModel = (updater) =>
        setMessages(prev => prev.map(m => m.id === modelIdx ? { ...m, ...updater(m) } : m))

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = JSON.parse(line.slice(6))

          if (payload.type === 'status') {
            updateModel(m => ({ status: payload.text }))
          } else if (payload.type === 'rewritten') {
            updateModel(m => ({ rewritten: payload.text }))
          } else if (payload.type === 'token') {
            updateModel(m => ({ text: (m.text || '') + payload.text, status: null }))
          } else if (payload.type === 'done') {
            updateModel(m => ({ status: null }))
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === modelIdx ? { ...m, status: null, text: 'Could not reach the server.' } : m
      ))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui', height: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 680, margin: '0 auto', padding: '24px 16px', background: t.bg, color: t.text }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>RAG Chat</h1>
          <p style={{ color: t.muted, fontSize: 13 }}>{ready ? '● Connected' : '○ Server not ready'}</p>
        </div>
        <button onClick={() => setMode(m => m === 'dark' ? 'light' : 'dark')}
          style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: 'pointer', fontSize: 13 }}>
          {mode === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>
        {messages.length === 0 && (
          <p style={{ color: t.muted, textAlign: 'center', marginTop: 40 }}>Ask anything from the knowledge base</p>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
            <div style={{ fontSize: 11, color: t.muted, marginBottom: 3, textAlign: m.role === 'user' ? 'right' : 'left' }}>
              {m.role === 'user' ? 'You' : 'Model'}
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5,
              background: m.role === 'user' ? t.userBg : t.modelBg,
              color:      m.role === 'user' ? t.userText : t.text,
              border: `1px solid ${t.border}`,
            }}>
              {/* Stage indicator */}
              {m.status && (
                <div style={{ fontSize: 12, color: t.statusColor, marginBottom: m.text ? 8 : 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                  {m.status}
                </div>
              )}

              {/* Rewritten query hint */}
              {m.rewritten && m.rewritten !== m.originalQuestion && (
                <div style={{ fontSize: 11, color: t.muted, marginBottom: 6, fontStyle: 'italic' }}>
                  ✎ {m.rewritten}
                </div>
              )}

              {/* Answer text */}
              {m.text || (!m.status && <span style={{ color: t.muted }}>…</span>)}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

      <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${t.border}`, paddingTop: 12 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask a question..."
          style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, outline: 'none', background: t.surface, color: t.text }}
        />
        <button onClick={send} disabled={loading}
          style={{ padding: '10px 18px', background: t.userBg, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.4 : 1 }}>
          Ask
        </button>
      </div>

    </div>
  )
}