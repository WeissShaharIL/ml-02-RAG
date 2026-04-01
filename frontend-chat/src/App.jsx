import { useEffect, useState } from 'react'

const API = '/api'

const themes = {
  dark:  { bg: '#0f0f0f', surface: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', muted: '#888', userBg: '#2563eb', userText: '#fff', modelBg: '#1e1e1e' },
  light: { bg: '#f5f5f3', surface: '#fff',     border: '#e0dfd8', text: '#1a1a18', muted: '#73726c', userBg: '#1a1a18', userText: '#f5f5f3', modelBg: '#fff' },
}

export default function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [ready, setReady]       = useState(false)
  const [mode, setMode]         = useState('dark')

  const t = themes[mode]

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setReady(d.status === 'ok'))
      .catch(() => setReady(false))
  }, [])

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setLoading(true)
    try {
      const res  = await fetch(`${API}/ask`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'model', text: data.answer }])
    } catch {
      setMessages(prev => [...prev, { role: 'model', text: 'Could not reach the server.' }])
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
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
            <div style={{ fontSize: 11, color: t.muted, marginBottom: 3, textAlign: m.role === 'user' ? 'right' : 'left' }}>
              {m.role === 'user' ? 'You' : 'Model'}
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5,
              background: m.role === 'user' ? t.userBg : t.modelBg,
              color:      m.role === 'user' ? t.userText : t.text,
              border: `1px solid ${t.border}`,
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && <div style={{ alignSelf: 'flex-start', color: t.muted, fontSize: 13 }}>thinking...</div>}
      </div>

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