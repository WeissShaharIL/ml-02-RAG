import { useEffect, useState, useRef } from 'react'

const API = '/api'

const themes = {
  dark:  { bg: '#0f0f0f', surface: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', muted: '#888', up: '#22c55e', down: '#ef4444', inputBg: '#111', logBg: '#0a0a0a', overlay: '#000000cc' },
  light: { bg: '#f9fafb', surface: '#fff',     border: '#e5e7eb', text: '#1a1a18', muted: '#6b7280', up: '#22c55e', down: '#ef4444', inputBg: '#fff', logBg: '#f0f0ee', overlay: '#00000066' },
}

const SERVICE_COLORS = { backend: '#60a5fa', ollama: '#facc15', postgres: '#4ade80' }
const MAX_LINES = 500

const StatusDot = ({ status, t }) => (
  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: status === 'up' ? t.up : status === 'down' ? t.down : t.border, marginRight: 8 }} />
)

// ── Score bar ─────────────────────────────────────────────────────────────────
const ScoreBar = ({ score, max = 10, t }) => {
  const pct   = (score / max) * 100
  const color = score >= 7 ? '#22c55e' : score >= 4 ? '#facc15' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: t.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 32, textAlign: 'right' }}>{score}/{max}</span>
    </div>
  )
}


// ── Thumbs buttons ────────────────────────────────────────────────────────────
const ThumbsButtons = ({ resultId, humanScore, onVote, t }) => {
  const [saving, setSaving] = useState(false)

  const vote = async (score) => {
    setSaving(true)
    try {
      const newScore = humanScore === score ? null : score  // toggle off if same
      await fetch(`${API}/eval/results/${resultId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_score: newScore }),
      })
      onVote(resultId, newScore)
    } catch {}
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: t.muted, marginRight: 2 }}>Your rating:</span>
      <button onClick={() => vote(10)} disabled={saving}
        style={{ fontSize: 16, padding: '2px 8px', borderRadius: 6, border: `1px solid ${humanScore === 10 ? '#22c55e' : t.border}`, background: humanScore === 10 ? '#22c55e22' : 'transparent', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
        👍
      </button>
      <button onClick={() => vote(0)} disabled={saving}
        style={{ fontSize: 16, padding: '2px 8px', borderRadius: 6, border: `1px solid ${humanScore === 0 ? '#ef4444' : t.border}`, background: humanScore === 0 ? '#ef444422' : 'transparent', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
        👎
      </button>
      {humanScore !== null && humanScore !== undefined && (
        <span style={{ fontSize: 11, color: humanScore === 10 ? '#22c55e' : '#ef4444', marginLeft: 2 }}>
          {humanScore === 10 ? 'Marked correct' : 'Marked incorrect'}
        </span>
      )}
    </div>
  )
}

// ── Page Detail Modal ─────────────────────────────────────────────────────────
function PageModal({ pageId, t, onClose }) {
  const [page, setPage]       = useState(null)
  const [chunks, setChunks]   = useState([])
  const [tab, setTab]         = useState('content')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [pr, cr] = await Promise.all([fetch(`${API}/pages/${pageId}`), fetch(`${API}/pages/${pageId}/chunks`)])
        setPage(await pr.json())
        setChunks(await cr.json())
      } catch {}
      setLoading(false)
    }
    load()
  }, [pageId])

  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: t.overlay, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, width: '100%', maxWidth: 720, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loading ? 'Loading...' : page?.title}</h2>
              {page?.url && <a href={page.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.url}</a>}
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['content', 'chunks'].map(tb => (
              <button key={tb} onClick={() => setTab(tb)}
                style={{ padding: '5px 14px', borderRadius: 7, border: `1px solid ${t.border}`, background: tab === tb ? '#2563eb' : 'transparent', color: tab === tb ? '#fff' : t.muted, fontSize: 13, cursor: 'pointer' }}>
                {tb === 'content' ? 'Raw Content' : `Chunks (${chunks.length})`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading && <p style={{ color: t.muted, fontSize: 14 }}>Loading...</p>}
          {!loading && tab === 'content' && <pre style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: t.text, margin: 0, fontFamily: 'system-ui' }}>{page?.content}</pre>}
          {!loading && tab === 'chunks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {chunks.map(chunk => (
                <div key={chunk.position} style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 11, color: t.muted, marginBottom: 6, fontFamily: 'monospace' }}>chunk #{chunk.position}</div>
                  <p style={{ fontSize: 13, lineHeight: 1.7, color: t.text, margin: 0 }}>{chunk.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [health, setHealth]         = useState(null)
  const [pages, setPages]           = useState([])
  const [mode, setMode]             = useState('dark')
  const [ingestTab, setIngestTab]   = useState('url')
  const [url, setUrl]               = useState('')
  const [title, setTitle]           = useState('')
  const [text, setText]             = useState('')
  const [ingesting, setIngesting]   = useState(false)
  const [message, setMessage]       = useState(null)
  const [confirmId, setConfirmId]   = useState(null)
  const [deleting, setDeleting]     = useState(null)
  const [modalPageId, setModalPageId] = useState(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting]       = useState(false)

  // Eval state
  const [evalStatus, setEvalStatus]     = useState(null)   // 'generating' | 'running' | null
  const [evalProgress, setEvalProgress] = useState(null)   // current step text
  const [evalResults, setEvalResults]   = useState([])     // per-question results as they arrive
  const [evalSummary, setEvalSummary]   = useState(null)   // { score_avg, total }
  const [pastRuns, setPastRuns]         = useState([])
  const [humanScores, setHumanScores]   = useState({})  // resultId -> human_score

  const handleVote = (resultId, score) => {
    setHumanScores(prev => ({ ...prev, [resultId]: score }))
    // Also update expandedRunData if open
    setExpandedRunData(prev => prev ? {
      ...prev,
      results: prev.results.map(r => r.id === resultId ? { ...r, human_score: score } : r)
    } : prev)
  }
  const [expandedRun, setExpandedRun]   = useState(null)
  const [versions, setVersions]         = useState([])
  const [saving, setSaving]             = useState(false)
  const [expandedRunData, setExpandedRunData] = useState(null)
  const [generatedQs, setGeneratedQs]   = useState([])
  const [quizCollapsed, setQuizCollapsed]       = useState(false)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [questionsLoading, setQuestionsLoading] = useState(true)

  // Logs state
  const [logLines, setLogLines]         = useState([])
  const [logPaused, setLogPaused]       = useState(false)
  const [logFilter, setLogFilter]       = useState('all')
  const [logConnected, setLogConnected] = useState(false)
  const logBottomRef = useRef(null)
  const logPausedRef = useRef(false)
  const esRef        = useRef(null)

  const t = themes[mode]

  useEffect(() => { logPausedRef.current = logPaused }, [logPaused])

  const fetchHealth = async () => {
    try { setHealth(await (await fetch(`${API}/health`)).json()) } catch { setHealth(null) }
  }
  const fetchPages = async () => {
    try { setPages(await (await fetch(`${API}/pages`)).json()) } catch { setPages([]) }
  }
  const fetchVersions = async () => {
    try { setVersions(await (await fetch(`${API}/versions`)).json()) } catch { setVersions([]) }
  }
  const fetchRuns = async () => {
    try { setPastRuns(await (await fetch(`${API}/eval/runs`)).json()) } catch { setPastRuns([]) }
  }
  const fetchQuestions = async () => {
    setQuestionsLoading(true)
    try {
      const data = await (await fetch(`${API}/eval/questions`)).json()
      setGeneratedQs(data.map(q => ({ id: q.id, question: q.question, expected_answer: q.expected_answer, page_title: q.page_title })))
    } catch { setGeneratedQs([]) }
    setQuestionsLoading(false)
  }

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
    es.onerror = () => { setLogConnected(false); es.close(); setTimeout(connectLogs, 3000) }
  }

  useEffect(() => {
    fetchHealth(); fetchPages(); fetchRuns(); fetchVersions(); fetchQuestions(); connectLogs()
    const iv = setInterval(() => { fetchHealth(); fetchPages() }, 10000)
    return () => { clearInterval(iv); if (esRef.current) esRef.current.close() }
  }, [])

  useEffect(() => {
    if (!logPaused) logBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines, logPaused])

  // ── Ingest ──────────────────────────────────────────────────────────────────
  const ingestURL = async () => {
    if (!url.trim()) return
    setIngesting(true); setMessage(null)
    try {
      const res = await fetch(`${API}/ingest/url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'success', text: `✓ Ingested "${data.title}" — ${data.chunks} chunks` })
      setUrl(''); fetchPages()
    } catch (e) { setMessage({ type: 'error', text: `✗ ${e.message}` }) }
    finally { setIngesting(false) }
  }

  const ingestText = async () => {
    if (!title.trim() || !text.trim()) return
    setIngesting(true); setMessage(null)
    try {
      const res = await fetch(`${API}/ingest/text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), text: text.trim() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'success', text: `✓ Ingested "${data.title}" — ${data.chunks} chunks` })
      setTitle(''); setText(''); fetchPages()
    } catch (e) { setMessage({ type: 'error', text: `✗ ${e.message}` }) }
    finally { setIngesting(false) }
  }

  const deletePage = async (id) => {
    setDeleting(id); setConfirmId(null)
    try {
      const res = await fetch(`${API}/pages/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setPages(prev => prev.filter(p => p.id !== id))
    } catch (e) { setMessage({ type: 'error', text: `✗ ${e.message}` }) }
    finally { setDeleting(null) }
  }

  const saveVersion = async () => {
    setSaving(true)
    try {
      const res  = await fetch(`${API}/versions/save`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'success', text: `✓ Version ${data.version_name} saved — ${data.page_count} pages${data.score_avg ? `, score ${data.score_avg}/10` : ''}` })
      fetchVersions()
    } catch (e) { setMessage({ type: 'error', text: `✗ ${e.message}` }) }
    finally { setSaving(false) }
  }

  const resetAll = async () => {
    setResetting(true)
    try {
      await fetch(`${API}/reset`, { method: 'POST' })
      setPages([])
      setGeneratedQs([])
      setPastRuns([])
      setVersions([])
      setEvalResults([])
      setEvalSummary(null)
      setEvalProgress(null)
      setMessage({ type: 'success', text: '✓ All data wiped. System ready for fresh ingestion.' })
    } catch (e) {
      setMessage({ type: 'error', text: `✗ Reset failed: ${e.message}` })
    } finally {
      setResetting(false)
      setResetConfirm(false)
    }
  }

  // ── Eval: generate questions ────────────────────────────────────────────────
  const runGenerate = async () => {
    setEvalStatus('generating')
    setEvalProgress('Starting...')
    setGeneratedQs([])

    try {
      const res    = await fetch(`${API}/eval/generate`, { method: 'POST' })
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let   buf    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const p = JSON.parse(line.slice(6))
          if (p.type === 'status')   setEvalProgress(p.text)
          if (p.type === 'warning')  setEvalProgress(`⚠ ${p.text}`)
          if (p.type === 'question') setGeneratedQs(prev => [...prev, { question: p.question, expected_answer: p.expected_answer, page_title: p.page_title }])
          if (p.type === 'error')    setEvalProgress(`✗ ${p.text}`)
          if (p.type === 'done') {
            setEvalProgress(`✓ Generated ${p.count} questions`)
            fetchQuestions()
          }
        }
      }
    } catch (e) { setEvalProgress(`✗ ${e.message}`) }
    finally { setEvalStatus(null) }
  }

  // ── Eval: run evaluation ────────────────────────────────────────────────────
  const runEval = async () => {
    setEvalStatus('running')
    setEvalProgress('Starting evaluation...')
    setEvalResults([])
    setEvalSummary(null)
    setResultsCollapsed(false)
    setQuizCollapsed(true)

    try {
      const res    = await fetch(`${API}/eval/run`, { method: 'POST' })
      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let   buf    = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const p = JSON.parse(line.slice(6))
          if (p.type === 'status')   setEvalProgress(p.text)
          if (p.type === 'progress') setEvalProgress(`Q${p.question_num}/${p.total} — ${p.step}: ${p.question.slice(0, 60)}...`)
          if (p.type === 'result')   setEvalResults(prev => [...prev, p])
          if (p.type === 'error')    setEvalProgress(`✗ ${p.text}`)
          if (p.type === 'done') {
            setEvalSummary({ score_avg: p.score_avg, total: p.total })
            setEvalProgress(null)
            fetchRuns()
          }
        }
      }
    } catch (e) { setEvalProgress(`✗ ${e.message}`) }
    finally { setEvalStatus(null) }
  }

  const loadRun = async (id) => {
    if (expandedRun === id) { setExpandedRun(null); setExpandedRunData(null); return }
    setExpandedRun(id)
    try {
      const data = await (await fetch(`${API}/eval/runs/${id}`)).json()
      setExpandedRunData(data)
    } catch { setExpandedRunData(null) }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  const card  = { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }
  const input = { width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${t.border}`, fontSize: 14, background: t.inputBg, color: t.text, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }
  const btn   = (disabled, color = '#2563eb') => ({ padding: '10px 18px', background: color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 })

  const visibleLines = logFilter === 'all' ? logLines : logLines.filter(l => l.service === logFilter)

  return (
    <div style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 700, margin: '0 auto', minHeight: '100vh', background: t.bg, color: t.text }}>

      {modalPageId && <PageModal pageId={modalPageId} t={t} onClose={() => setModalPageId(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 4 }}>RAG Platform</h1>
          <p style={{ color: t.muted }}>DevOps Dashboard</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {resetConfirm ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: t.down }}>Wipe all data?</span>
              <button onClick={resetAll} disabled={resetting}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, opacity: resetting ? 0.5 : 1 }}>
                {resetting ? '...' : 'Yes, wipe'}
              </button>
              <button onClick={() => setResetConfirm(false)}
                style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setResetConfirm(true)}
              style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.down}`, background: 'transparent', color: t.down, cursor: 'pointer', fontSize: 13 }}>
              🗑 Reset All
            </button>
          )}
          <button onClick={() => setMode(m => m === 'dark' ? 'light' : 'dark')}
            style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${t.border}`, background: t.surface, color: t.text, cursor: 'pointer', fontSize: 13 }}>
            {mode === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>

      {/* Health */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Service Health</h2>
        {!health && <p style={{ color: t.muted }}>Checking...</p>}
        {health && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[{ label: 'Backend', status: health.status === 'ok' ? 'up' : 'down' }, { label: 'PostgreSQL', status: health.postgres }, { label: 'Ollama', status: health.ollama }].map(({ label, status }) => (
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
            <button key={t2} onClick={() => setIngestTab(t2)}
              style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${t.border}`, background: ingestTab === t2 ? '#2563eb' : t.surface, color: ingestTab === t2 ? '#fff' : t.text, cursor: 'pointer', fontSize: 13 }}>
              {t2 === 'url' ? '🔗 URL' : '📝 Paste Text'}
            </button>
          ))}
        </div>
        {ingestTab === 'url' && (
          <div>
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && ingestURL()} placeholder="https://en.wikipedia.org/wiki/Space_exploration" style={input} />
            <button onClick={ingestURL} disabled={ingesting || !url.trim()} style={btn(ingesting || !url.trim())}>{ingesting ? 'Ingesting...' : 'Ingest URL'}</button>
          </div>
        )}
        {ingestTab === 'text' && (
          <div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={input} />
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste your text here..." style={{ ...input, height: 150, resize: 'vertical', fontFamily: 'inherit' }} />
            <button onClick={ingestText} disabled={ingesting || !title.trim() || !text.trim()} style={btn(ingesting || !title.trim() || !text.trim())}>{ingesting ? 'Ingesting...' : 'Ingest Text'}</button>
          </div>
        )}
        {message && <p style={{ marginTop: 12, fontSize: 13, color: message.type === 'success' ? t.up : t.down }}>{message.text}</p>}
      </div>

      {/* Knowledge Base */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Knowledge Base ({pages.length} pages)</h2>
        {pages.length === 0 && <p style={{ color: t.muted, fontSize: 14 }}>No pages ingested yet.</p>}
        {pages.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '10px 0', borderBottom: `1px solid ${t.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div onClick={() => setModalPageId(p.id)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: t.text }}
                onMouseEnter={e => e.target.style.color = '#60a5fa'} onMouseLeave={e => e.target.style.color = t.text}>{p.title}</div>
              <div style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{new Date(p.created_at).toLocaleDateString()}</div>
            </div>
            {confirmId === p.id ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: t.muted }}>Delete?</span>
                <button onClick={() => deletePage(p.id)} style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Yes</button>
                <button onClick={() => setConfirmId(null)} style={{ padding: '4px 10px', background: t.surface, color: t.text, border: `1px solid ${t.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>No</button>
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

      {/* Versions */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 500 }}>Versions</h2>
            <p style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>Snapshot the current knowledge base as an immutable version.</p>
          </div>
          <button onClick={saveVersion} disabled={saving}
            style={{ padding: '8px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, flexShrink: 0 }}>
            {saving ? '⟳ Saving...' : '💾 Save Version'}
          </button>
        </div>
        {versions.length === 0 && <p style={{ color: t.muted, fontSize: 13 }}>No versions saved yet.</p>}
        {versions.map(v => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '10px 0', borderBottom: `1px solid ${t.border}` }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#a78bfa' }}>{v.name}</span>
            <span style={{ flex: 1, color: t.muted, fontSize: 12 }}>{v.page_count} pages</span>
            {v.score_avg != null && (
              <span style={{ fontSize: 12, color: v.score_avg >= 7 ? t.up : v.score_avg >= 4 ? '#facc15' : t.down }}>
                {v.score_avg}/10
              </span>
            )}
            <span style={{ color: t.muted, fontSize: 11 }}>{new Date(v.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* Evaluation */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Evaluation</h2>
        <p style={{ color: t.muted, fontSize: 13, marginBottom: 16 }}>Generate questions from the knowledge base, then run the RAG pipeline against them.</p>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={runGenerate} disabled={!!evalStatus}
            style={btn(!!evalStatus, '#7c3aed')}>
            {evalStatus === 'generating' ? '⟳ Generating...' : '⚡ Generate Questions'}
          </button>
          <button onClick={runEval} disabled={!!evalStatus}
            style={btn(!!evalStatus, '#059669')}>
            {evalStatus === 'running' ? '⟳ Evaluating...' : '▶ Run Evaluation'}
          </button>
        </div>

        {/* Live progress */}
        {evalProgress && (
          <div style={{ fontSize: 13, color: t.muted, marginBottom: 12, padding: '8px 12px', background: t.logBg, borderRadius: 8, border: `1px solid ${t.border}`, fontFamily: 'monospace' }}>
            {evalStatus && <span style={{ marginRight: 6 }}>⟳</span>}{evalProgress}
          </div>
        )}

        {/* Quiz bank */}
        {(questionsLoading || generatedQs.length > 0) && (
          <div style={{ marginBottom: 16 }}>
            <div onClick={() => setQuizCollapsed(c => !c)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: quizCollapsed ? 0 : 8 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>Quiz Bank ({generatedQs.length} questions)</p>
              <span style={{ fontSize: 11, color: t.muted }}>{quizCollapsed ? '▼ show' : '▲ hide'}</span>
            </div>
            {!quizCollapsed && (
              <>
                {questionsLoading && <p style={{ color: t.muted, fontSize: 13 }}>Loading...</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {generatedQs.map((q, i) => (
                    <div key={i} style={{ padding: '10px 14px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13 }}>
                      <div style={{ color: t.muted, fontSize: 11, marginBottom: 4 }}>{q.page_title}</div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>Q: {q.question}</div>
                      <div style={{ color: t.muted }}>A: {q.expected_answer}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Live eval results */}
        {evalResults.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div onClick={() => setResultsCollapsed(c => !c)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>
                {evalSummary ? `Results — avg score: ${evalSummary.score_avg}/10` : `Results (${evalResults.length} so far...)`}
              </p>
              <span style={{ fontSize: 11, color: t.muted }}>{resultsCollapsed ? '▼ show' : '▲ hide'}</span>
            </div>
            {evalSummary && <ScoreBar score={evalSummary.score_avg} t={t} />}
            {!resultsCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                {evalResults.map((r, i) => (
                  <div key={i} style={{ padding: '12px 14px', border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 13 }}>
                    <div style={{ fontWeight: 500, marginBottom: 6 }}>Q{r.question_num}: {r.question}</div>
                    <div style={{ color: t.muted, marginBottom: 3 }}>Expected: {r.expected_answer}</div>
                    <div style={{ color: t.text, marginBottom: 8 }}>Got: {r.actual_answer}</div>
                    <ScoreBar score={r.score} t={t} />
                    {r.id && <ThumbsButtons resultId={r.id} humanScore={humanScores[r.id]} onVote={handleVote} t={t} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Past runs */}
        {pastRuns.length > 0 && (
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: t.muted }}>Past Runs</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pastRuns.map(run => (
                <div key={run.id}>
                  <div onClick={() => loadRun(run.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: `1px solid ${t.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    <span style={{ color: t.muted, fontSize: 11 }}>#{run.id}</span>
                    <span style={{ flex: 1 }}>{new Date(run.created_at).toLocaleString()}</span>
                    <span style={{ fontWeight: 600, color: run.score_avg >= 7 ? t.up : run.score_avg >= 4 ? '#facc15' : t.down }}>{run.score_avg}/10</span>
                    {run.duration_seconds != null && (
                      <span style={{ color: t.muted, fontSize: 11 }}>{run.duration_seconds >= 60 ? `${Math.floor(run.duration_seconds/60)}m ${run.duration_seconds%60}s` : `${run.duration_seconds}s`}</span>
                    )}
                    <span style={{ color: t.muted, fontSize: 11 }}>{expandedRun === run.id ? '▲' : '▼'}</span>
                  </div>
                  {expandedRun === run.id && expandedRunData && (
                    <div style={{ padding: '12px 14px', border: `1px solid ${t.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {expandedRunData.results.map((r, i) => (
                        <div key={i} style={{ fontSize: 13, paddingBottom: 10, borderBottom: i < expandedRunData.results.length - 1 ? `1px solid ${t.border}` : 'none' }}>
                          <div style={{ fontWeight: 500, marginBottom: 4 }}>Q: {r.question}</div>
                          <div style={{ color: t.muted, marginBottom: 2, fontSize: 12 }}>Expected: {r.expected_answer}</div>
                          <div style={{ color: t.text, marginBottom: 6, fontSize: 12 }}>Got: {r.actual_answer}</div>
                          <ScoreBar score={r.score} t={t} />
                          <ThumbsButtons resultId={r.id} humanScore={r.human_score} onVote={handleVote} t={t} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Live Logs */}
      <div style={card}>
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
              style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.surface, color: t.muted, fontSize: 12, cursor: 'pointer' }}>Clear</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['all', 'backend', 'ollama', 'postgres'].map(f => (
            <button key={f} onClick={() => setLogFilter(f)}
              style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: `1px solid ${logFilter === f ? (SERVICE_COLORS[f] || t.border) : t.border}`, background: logFilter === f ? (SERVICE_COLORS[f] ? SERVICE_COLORS[f] + '22' : t.surface) : 'transparent', color: logFilter === f ? (SERVICE_COLORS[f] || t.text) : t.muted }}>
              {f}
            </button>
          ))}
        </div>
        <div style={{ height: 320, overflowY: 'auto', background: t.logBg, borderRadius: 8, border: `1px solid ${t.border}`, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
          {visibleLines.length === 0 && <span style={{ color: t.muted }}>Waiting for logs...</span>}
          {visibleLines.map(({ id, service, line }) => (
            <div key={id} style={{ display: 'flex', gap: 8, wordBreak: 'break-all' }}>
              <span style={{ color: SERVICE_COLORS[service], flexShrink: 0, userSelect: 'none' }}>[{service}]</span>
              <span style={{ color: t.text }}>{line}</span>
            </div>
          ))}
          <div ref={logBottomRef} />
        </div>
        {logPaused && <p style={{ fontSize: 12, color: t.muted, marginTop: 6 }}>⏸ Paused — {logLines.length} lines buffered.</p>}
      </div>

    </div>
  )
}