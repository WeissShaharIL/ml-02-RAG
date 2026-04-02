import { useEffect, useState, useRef } from 'react'

const API = '/api'

const themes = {
  dark:  { bg: '#0a0a0b', surface: '#111113', surface2: '#18181c', border: '#222228', text: '#f0f0f0', muted: '#666', up: '#22c55e', down: '#ef4444', inputBg: '#0e0e11', logBg: '#08080a', overlay: '#000000cc', accent: '#3b82f6' },
  light: { bg: '#f0f0f2', surface: '#ffffff',  surface2: '#f7f7f9', border: '#e0e0e6', text: '#111116', muted: '#888', up: '#16a34a', down: '#dc2626', inputBg: '#ffffff', logBg: '#eeeef2', overlay: '#00000066', accent: '#2563eb' },
}

const SERVICE_COLORS = { backend: '#60a5fa', ollama: '#facc15', postgres: '#4ade80' }
const MAX_LINES = 500

const StatusDot = ({ status, t }) => (
  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: status === 'up' ? t.up : status === 'down' ? t.down : t.border, marginRight: 8, flexShrink: 0 }} />
)

const ScoreBar = ({ score, max = 10, t }) => {
  const pct   = (score / max) * 100
  const color = score >= 7 ? '#22c55e' : score >= 4 ? '#facc15' : '#ef4444'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: t.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 28, textAlign: 'right' }}>{score}/{max}</span>
    </div>
  )
}

const ThumbsButtons = ({ resultId, humanScore, onVote, t }) => {
  const [saving, setSaving] = useState(false)
  const vote = async (score) => {
    setSaving(true)
    try {
      const newScore = humanScore === score ? null : score
      await fetch(`${API}/eval/results/${resultId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ human_score: newScore }) })
      onVote(resultId, newScore)
    } catch {}
    setSaving(false)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: t.muted, marginRight: 2 }}>Your rating:</span>
      <button onClick={() => vote(10)} disabled={saving} style={{ fontSize: 14, padding: '2px 8px', borderRadius: 6, border: `1px solid ${humanScore === 10 ? '#22c55e' : t.border}`, background: humanScore === 10 ? '#22c55e22' : 'transparent', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>👍</button>
      <button onClick={() => vote(0)} disabled={saving} style={{ fontSize: 14, padding: '2px 8px', borderRadius: 6, border: `1px solid ${humanScore === 0 ? '#ef4444' : t.border}`, background: humanScore === 0 ? '#ef444422' : 'transparent', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>👎</button>
      {humanScore !== null && humanScore !== undefined && (
        <span style={{ fontSize: 11, color: humanScore === 10 ? '#22c55e' : '#ef4444', marginLeft: 2 }}>{humanScore === 10 ? 'Marked correct' : 'Marked incorrect'}</span>
      )}
    </div>
  )
}

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
        setPage(await pr.json()); setChunks(await cr.json())
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
      <div onClick={e => e.stopPropagation()} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, width: '100%', maxWidth: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loading ? 'Loading...' : page?.title}</h2>
              {page?.url && <a href={page.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#60a5fa', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.url}</a>}
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: t.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['content', 'chunks'].map(tb => (
              <button key={tb} onClick={() => setTab(tb)} style={{ padding: '5px 14px', borderRadius: 7, border: `1px solid ${t.border}`, background: tab === tb ? t.accent : 'transparent', color: tab === tb ? '#fff' : t.muted, fontSize: 13, cursor: 'pointer' }}>
                {tb === 'content' ? 'Raw Content' : `Chunks (${chunks.length})`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading && <p style={{ color: t.muted, fontSize: 14 }}>Loading...</p>}
          {!loading && tab === 'content' && <pre style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: t.text, margin: 0, fontFamily: 'system-ui' }}>{page?.content}</pre>}
          {!loading && tab === 'chunks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

const SectionHeader = ({ title, t }) => (
  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.muted, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${t.border}` }}>
    {title}
  </div>
)

const Card = ({ children, t, style = {} }) => (
  <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 12, ...style }}>
    {children}
  </div>
)

export default function App() {
  const [health, setHealth]           = useState(null)
  const [pages, setPages]             = useState([])
  const [mode, setMode]               = useState('dark')
  const [ingestTab, setIngestTab]     = useState('url')
  const [url, setUrl]                 = useState('')
  const [title, setTitle]             = useState('')
  const [text, setText]               = useState('')
  const [ingesting, setIngesting]     = useState(false)
  const [message, setMessage]         = useState(null)
  const [confirmId, setConfirmId]     = useState(null)
  const [deleting, setDeleting]       = useState(null)
  const [modalPageId, setModalPageId] = useState(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting]     = useState(false)

  const [evalStatus, setEvalStatus]       = useState(null)
  const [evalNumQ, setEvalNumQ]           = useState(10)
  const [generateNumQ, setGenerateNumQ]   = useState(10)
  const [evalCycles, setEvalCycles]       = useState(1)
  const [evalProgress, setEvalProgress]   = useState(null)
  const [evalResults, setEvalResults]     = useState([])
  const [evalSummary, setEvalSummary]     = useState(null)
  const [pastRuns, setPastRuns]           = useState([])
  const [humanScores, setHumanScores]     = useState({})
  const [expandedRun, setExpandedRun]     = useState(null)
  const [expandedRunData, setExpandedRunData] = useState(null)
  const [versions, setVersions]           = useState([])
  const [saving, setSaving]               = useState(false)
  const [generatedQs, setGeneratedQs]     = useState([])
  const [quizCollapsed, setQuizCollapsed] = useState(false)
  const [quizSearch, setQuizSearch]       = useState('')
  const [confirmDeleteQ, setConfirmDeleteQ] = useState(null)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [questionsLoading, setQuestionsLoading] = useState(true)

  const [logLines, setLogLines]           = useState([])
  const [logsCollapsed, setLogsCollapsed] = useState(false)
  const [logPaused, setLogPaused]         = useState(false)
  const [logFilter, setLogFilter]         = useState('all')
  const [logConnected, setLogConnected]   = useState(false)
  const logContainerRef = useRef(null)
  const logPausedRef    = useRef(false)
  const esRef           = useRef(null)

  const t = themes[mode]

  useEffect(() => { logPausedRef.current = logPaused }, [logPaused])

  const fetchHealth    = async () => { try { setHealth(await (await fetch(`${API}/health`)).json()) } catch { setHealth(null) } }
  const fetchPages     = async () => { try { setPages(await (await fetch(`${API}/pages`)).json()) } catch { setPages([]) } }
  const fetchVersions  = async () => { try { setVersions(await (await fetch(`${API}/versions`)).json()) } catch { setVersions([]) } }
  const fetchRuns      = async () => { try { setPastRuns(await (await fetch(`${API}/eval/runs`)).json()) } catch { setPastRuns([]) } }
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
    if (!logPaused && logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
  }, [logLines, logPaused])

  const handleVote = (resultId, score) => {
    setHumanScores(prev => ({ ...prev, [resultId]: score }))
    setExpandedRunData(prev => prev ? { ...prev, results: prev.results.map(r => r.id === resultId ? { ...r, human_score: score } : r) } : prev)
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
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

  const deleteQuestion = async (id) => {
    try {
      const res = await fetch(`${API}/eval/questions/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setGeneratedQs(prev => prev.filter(q => q.id !== id))
    } catch (e) { setMessage({ type: 'error', text: `✗ ${e.message}` }) }
    finally { setConfirmDeleteQ(null) }
  }

  const saveVersion = async () => {
    setSaving(true)
    try {
      const res = await fetch(`${API}/versions/save`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setMessage({ type: 'success', text: `✓ Version ${data.version_name} saved — ${data.page_count} pages${data.score_avg ? ` 🤖 ${data.score_avg}/10` : ''}${data.human_score_avg != null ? ` 👤 ${data.human_score_avg}/10` : ''}` })
      fetchVersions()
    } catch (e) { setMessage({ type: 'error', text: `✗ ${e.message}` }) }
    finally { setSaving(false) }
  }

  const resetAll = async () => {
    setResetting(true)
    try {
      await fetch(`${API}/reset`, { method: 'POST' })
      setPages([]); setGeneratedQs([]); setPastRuns([]); setVersions([])
      setEvalResults([]); setEvalSummary(null); setEvalProgress(null)
      setMessage({ type: 'success', text: '✓ All data wiped.' })
    } catch (e) { setMessage({ type: 'error', text: `✗ Reset failed: ${e.message}` }) }
    finally { setResetting(false); setResetConfirm(false) }
  }

  const runGenerate = async () => {
    setEvalStatus('generating'); setEvalProgress('Starting...')
    try {
      const res = await fetch(`${API}/eval/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ num_questions: parseInt(generateNumQ) || 10 }) })
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const p = JSON.parse(line.slice(6))
          if (p.type === 'status')   setEvalProgress(p.text)
          if (p.type === 'warning')  setEvalProgress(`⚠ ${p.text}`)
          if (p.type === 'question') setGeneratedQs(prev => [...prev, { id: p.id, question: p.question, expected_answer: p.expected_answer, page_title: p.page_title }])
          if (p.type === 'error')    setEvalProgress(`✗ ${p.text}`)
          if (p.type === 'done')    { setEvalProgress(`✓ Generated ${p.count} questions`); fetchQuestions() }
        }
      }
    } catch (e) { setEvalProgress(`✗ ${e.message}`) }
    finally { setEvalStatus(null) }
  }

  const runEval = async () => {
    setEvalStatus('running'); setEvalProgress('Starting evaluation...')
    setEvalResults([]); setEvalSummary(null); setResultsCollapsed(false); setQuizCollapsed(true)
    try {
      const effectiveNumQ    = Math.min(parseInt(evalNumQ) || 10, generatedQs.length || parseInt(evalNumQ) || 10)
      const effectiveCycles  = Math.max(1, parseInt(evalCycles) || 1)
      const res = await fetch(`${API}/eval/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ num_questions: effectiveNumQ, cycles: effectiveCycles }) })
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const p = JSON.parse(line.slice(6))
          if (p.type === 'status')     setEvalProgress(p.text)
          if (p.type === 'progress')   setEvalProgress(`Q${p.question_num}/${p.total} — ${p.step}: ${p.question.slice(0, 60)}...`)
          if (p.type === 'result')     setEvalResults(prev => [...prev, p])
          if (p.type === 'error')      setEvalProgress(`✗ ${p.text}`)
          if (p.type === 'cycle_done') { setEvalSummary({ score_avg: p.score_avg, total: p.total }); setEvalProgress(p.cycles > 1 ? `Cycle ${p.cycle}/${p.cycles} — ${p.score_avg}/10` : null); fetchRuns() }
          if (p.type === 'done')       { setEvalSummary({ score_avg: p.score_avg, total: p.total }); setEvalProgress(null); fetchRuns() }
        }
      }
    } catch (e) { setEvalProgress(`✗ ${e.message}`) }
    finally { setEvalStatus(null) }
  }

  const loadRun = async (id) => {
    if (expandedRun === id) { setExpandedRun(null); setExpandedRunData(null); return }
    setExpandedRun(id)
    try { setExpandedRunData(await (await fetch(`${API}/eval/runs/${id}`)).json()) }
    catch { setExpandedRunData(null) }
  }

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 7, border: `1px solid ${t.border}`, fontSize: 13, background: t.inputBg, color: t.text, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }
  const btn = (disabled, color = t.accent) => ({ padding: '8px 16px', background: color, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap' })
  const numInput = { width: 44, padding: '4px 8px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.inputBg, color: t.text, fontSize: 13, textAlign: 'center' }
  const visibleLines = logFilter === 'all' ? logLines : logLines.filter(l => l.service === logFilter)

  return (
    <div style={{ fontFamily: 'system-ui', minHeight: '100vh', background: t.bg, color: t.text, display: 'flex', flexDirection: 'column' }}>

      {modalPageId && <PageModal pageId={modalPageId} t={t} onClose={() => setModalPageId(null)} />}

      {/* ── Top bar ───────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${t.border}`, background: t.surface, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>RAG Platform</span>
          <span style={{ fontSize: 11, color: t.muted, padding: '2px 8px', border: `1px solid ${t.border}`, borderRadius: 20 }}>DevOps Dashboard</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {message && (
            <span style={{ fontSize: 12, color: message.type === 'success' ? t.up : t.down, maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {message.text}
            </span>
          )}
          {resetConfirm ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: t.down }}>Wipe all data?</span>
              <button onClick={resetAll} disabled={resetting} style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12, opacity: resetting ? 0.5 : 1 }}>{resetting ? '...' : 'Yes, wipe'}</button>
              <button onClick={() => setResetConfirm(false)} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${t.border}`, background: 'transparent', color: t.text, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setResetConfirm(true)} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${t.down}`, background: 'transparent', color: t.down, cursor: 'pointer', fontSize: 12 }}>🗑 Reset</button>
          )}
          <button onClick={() => setMode(m => m === 'dark' ? 'light' : 'dark')} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${t.border}`, background: 'transparent', color: t.text, cursor: 'pointer', fontSize: 12 }}>
            {mode === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>

      {/* ── 3-column body ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr 300px', minHeight: 0 }}>

        {/* ── LEFT SIDEBAR: Health + Versions ───────────────────────────────── */}
        <div style={{ borderRight: `1px solid ${t.border}`, padding: '20px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>

          <SectionHeader title="Services" t={t} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
            {!health && <p style={{ color: t.muted, fontSize: 12 }}>Checking...</p>}
            {health && [
              { label: 'Backend',    status: health.status === 'ok' ? 'up' : 'down' },
              { label: 'PostgreSQL', status: health.postgres },
              { label: 'Ollama',     status: health.ollama },
            ].map(({ label, status }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', fontSize: 13, padding: '7px 10px', borderRadius: 7, background: t.surface2, border: `1px solid ${t.border}` }}>
                <StatusDot status={status} t={t} />
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ fontSize: 11, color: status === 'up' ? t.up : t.down, fontWeight: 600 }}>{status}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${t.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.muted }}>Versions</span>
            <button onClick={saveVersion} disabled={saving} style={{ padding: '3px 10px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}>
              {saving ? '⟳' : '💾 Save'}
            </button>
          </div>
          {versions.length === 0 && <p style={{ color: t.muted, fontSize: 12 }}>No versions yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {versions.map(v => (
              <div key={v.id} style={{ padding: '8px 10px', borderRadius: 7, background: t.surface2, border: `1px solid ${t.border}`, fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#a78bfa', fontSize: 13 }}>{v.name}</span>
                  <span style={{ color: t.muted, fontSize: 11 }}>{v.page_count}p</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {v.score_avg != null && <span style={{ fontSize: 11, color: v.score_avg >= 7 ? t.up : v.score_avg >= 4 ? '#facc15' : t.down }}>🤖 {v.score_avg}/10</span>}
                  {v.human_score_avg != null && <span style={{ fontSize: 11, color: v.human_score_avg >= 7 ? t.up : v.human_score_avg >= 4 ? '#facc15' : t.down }}>👤 {v.human_score_avg}/10</span>}
                </div>
                <div style={{ color: t.muted, fontSize: 10, marginTop: 3 }}>{new Date(v.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CENTER: Ingest + KB + Eval ─────────────────────────────────────── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', borderRight: `1px solid ${t.border}` }}>

          <SectionHeader title="Ingest Knowledge" t={t} />
          <Card t={t}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {['url', 'text'].map(t2 => (
                <button key={t2} onClick={() => setIngestTab(t2)} style={{ padding: '5px 14px', borderRadius: 7, border: `1px solid ${t.border}`, background: ingestTab === t2 ? t.accent : 'transparent', color: ingestTab === t2 ? '#fff' : t.muted, cursor: 'pointer', fontSize: 12 }}>
                  {t2 === 'url' ? '🔗 URL' : '📝 Text'}
                </button>
              ))}
            </div>
            {ingestTab === 'url' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && ingestURL()} placeholder="https://..." style={{ ...inputStyle, margin: 0, flex: 1 }} />
                <button onClick={ingestURL} disabled={ingesting || !url.trim()} style={btn(ingesting || !url.trim())}>{ingesting ? '⟳' : 'Ingest'}</button>
              </div>
            )}
            {ingestTab === 'text' && (
              <div>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={inputStyle} />
                <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste text..." style={{ ...inputStyle, height: 100, resize: 'vertical', fontFamily: 'inherit' }} />
                <button onClick={ingestText} disabled={ingesting || !title.trim() || !text.trim()} style={btn(ingesting || !title.trim() || !text.trim())}>{ingesting ? 'Ingesting...' : 'Ingest Text'}</button>
              </div>
            )}
          </Card>

          <SectionHeader title={`Knowledge Base — ${pages.length} pages`} t={t} />
          <Card t={t} style={{ marginBottom: 20 }}>
            {pages.length === 0 && <p style={{ color: t.muted, fontSize: 13 }}>No pages ingested yet.</p>}
            {pages.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '8px 0', borderBottom: `1px solid ${t.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div onClick={() => setModalPageId(p.id)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: t.text }}
                    onMouseEnter={e => e.target.style.color = '#60a5fa'} onMouseLeave={e => e.target.style.color = t.text}>{p.title}</div>
                  <div style={{ color: t.muted, fontSize: 11, marginTop: 1 }}>{new Date(p.created_at).toLocaleDateString()}</div>
                </div>
                {confirmId === p.id ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: t.muted }}>Delete?</span>
                    <button onClick={() => deletePage(p.id)} style={{ padding: '3px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Yes</button>
                    <button onClick={() => setConfirmId(null)} style={{ padding: '3px 8px', background: 'transparent', color: t.muted, border: `1px solid ${t.border}`, borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmId(p.id)} disabled={deleting === p.id} style={{ padding: '3px 8px', background: 'transparent', color: t.muted, border: `1px solid ${t.border}`, borderRadius: 5, fontSize: 11, cursor: 'pointer', flexShrink: 0, opacity: deleting === p.id ? 0.4 : 1 }}>
                    {deleting === p.id ? '…' : '🗑'}
                  </button>
                )}
              </div>
            ))}
          </Card>

          <SectionHeader title="Evaluation" t={t} />
          <Card t={t}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
              <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: t.muted, width: 60 }}>Generate</span>
                  <input type="text" inputMode="numeric" value={generateNumQ} onChange={e => setGenerateNumQ(e.target.value)} onBlur={e => setGenerateNumQ(Math.max(1, parseInt(e.target.value) || 1))} style={numInput} />
                  <span style={{ color: t.muted }}>questions</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: t.muted, width: 60 }}>Evaluate</span>
                  <input type="text" inputMode="numeric" value={evalNumQ} onChange={e => setEvalNumQ(e.target.value)} onBlur={e => setEvalNumQ(Math.max(1, parseInt(e.target.value) || 1))} style={numInput} />
                  <span style={{ color: t.muted }}>questions ×</span>
                  <input type="text" inputMode="numeric" value={evalCycles} onChange={e => setEvalCycles(e.target.value)} onBlur={e => setEvalCycles(Math.max(1, parseInt(e.target.value) || 1))} style={numInput} />
                  <span style={{ color: t.muted }}>cycles</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={runGenerate} disabled={!!evalStatus} style={{ ...btn(!!evalStatus, '#7c3aed'), flex: 1 }}>{evalStatus === 'generating' ? '⟳ Generating...' : '⚡ Generate'}</button>
                <button onClick={runEval} disabled={!!evalStatus} style={{ ...btn(!!evalStatus, '#059669'), flex: 1 }}>{evalStatus === 'running' ? '⟳ Evaluating...' : '▶ Evaluate'}</button>
              </div>
            </div>
            {generatedQs.length > 0 && parseInt(evalNumQ) > generatedQs.length && (
              <p style={{ fontSize: 12, color: '#facc15', marginTop: 10, marginBottom: 0 }}>Only {generatedQs.length} questions available — will use {generatedQs.length}</p>
            )}
            {evalProgress && (
              <div style={{ fontSize: 12, color: t.muted, marginTop: 12, padding: '7px 10px', background: t.logBg, borderRadius: 7, border: `1px solid ${t.border}`, fontFamily: 'monospace' }}>
                {evalStatus && <span style={{ marginRight: 6 }}>⟳</span>}{evalProgress}
              </div>
            )}
          </Card>

          {/* Quiz bank */}
          {(questionsLoading || generatedQs.length > 0) && (
            <Card t={t}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: quizCollapsed ? 0 : 10 }}>
                <div onClick={() => setQuizCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Quiz Bank ({generatedQs.length})</span>
                  <span style={{ fontSize: 11, color: t.muted }}>{quizCollapsed ? '▼' : '▲'}</span>
                </div>
                {!quizCollapsed && (
                  <input type="text" placeholder="Search..." value={quizSearch} onChange={e => setQuizSearch(e.target.value)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: t.inputBg, color: t.text, fontSize: 12, outline: 'none', width: 160 }} />
                )}
              </div>
              {!quizCollapsed && (
                <>
                  {questionsLoading && <p style={{ color: t.muted, fontSize: 13 }}>Loading...</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                    {generatedQs.filter(q => !quizSearch || q.question.toLowerCase().includes(quizSearch.toLowerCase()) || q.expected_answer.toLowerCase().includes(quizSearch.toLowerCase()) || q.page_title.toLowerCase().includes(quizSearch.toLowerCase())).map((q, i) => (
                      <div key={q.id || i} style={{ padding: '10px 12px', border: `1px solid ${t.border}`, borderRadius: 7, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <div style={{ color: t.muted, fontSize: 11 }}>{q.page_title}</div>
                          {confirmDeleteQ === q.id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                              <button onClick={() => deleteQuestion(q.id)} style={{ padding: '2px 7px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Yes</button>
                              <button onClick={() => setConfirmDeleteQ(null)} style={{ padding: '2px 7px', background: 'transparent', color: t.muted, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>No</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDeleteQ(q.id)} style={{ padding: '2px 7px', background: 'transparent', color: t.muted, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>✕</button>
                          )}
                        </div>
                        <div style={{ fontWeight: 500, marginBottom: 3 }}>Q: {q.question}</div>
                        <div style={{ color: t.muted }}>A: {q.expected_answer}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {/* Live eval results */}
          {evalResults.length > 0 && (
            <Card t={t}>
              <div onClick={() => setResultsCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{evalSummary ? `Results — ${evalSummary.score_avg}/10 avg` : `Results (${evalResults.length}...)`}</span>
                <span style={{ fontSize: 11, color: t.muted }}>{resultsCollapsed ? '▼' : '▲'}</span>
              </div>
              {evalSummary && <ScoreBar score={evalSummary.score_avg} t={t} />}
              {!resultsCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, maxHeight: 400, overflowY: 'auto' }}>
                  {evalResults.map((r, i) => (
                    <div key={i} style={{ padding: '10px 12px', border: `1px solid ${t.border}`, borderRadius: 7, fontSize: 12 }}>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>Q{r.question_num}: {r.question}</div>
                      <div style={{ color: t.muted, marginBottom: 2 }}>Expected: {r.expected_answer}</div>
                      <div style={{ marginBottom: 6 }}>Got: {r.actual_answer}</div>
                      <ScoreBar score={r.score} t={t} />
                      {r.id && <ThumbsButtons resultId={r.id} humanScore={humanScores[r.id]} onVote={handleVote} t={t} />}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        {/* ── RIGHT SIDEBAR: Past Runs ───────────────────────────────────────── */}
        <div style={{ padding: '20px 16px', overflowY: 'auto' }}>
          <SectionHeader title="Past Runs" t={t} />
          {pastRuns.length === 0 && <p style={{ color: t.muted, fontSize: 12 }}>No runs yet.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pastRuns.map(run => (
              <div key={run.id}>
                <div onClick={() => loadRun(run.id)} style={{ padding: '10px 12px', border: `1px solid ${t.border}`, borderRadius: expandedRun === run.id ? '8px 8px 0 0' : 8, cursor: 'pointer', fontSize: 12, background: t.surface }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ color: t.muted, fontSize: 10 }}>#{run.id}</span>
                    <span style={{ flex: 1, color: t.muted, fontSize: 10 }}>{new Date(run.created_at).toLocaleString()}</span>
                    <span style={{ color: t.muted, fontSize: 10 }}>{expandedRun === run.id ? '▲' : '▼'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: run.score_avg >= 7 ? t.up : run.score_avg >= 4 ? '#facc15' : t.down }}>🤖 {run.score_avg}/10</span>
                    {run.human_score_avg != null && <span style={{ fontWeight: 600, color: run.human_score_avg >= 7 ? t.up : run.human_score_avg >= 4 ? '#facc15' : t.down }}>👤 {run.human_score_avg}/10</span>}
                    {run.duration_seconds != null && <span style={{ color: t.muted, fontSize: 10 }}>{run.duration_seconds >= 60 ? `${Math.floor(run.duration_seconds/60)}m${run.duration_seconds%60}s` : `${run.duration_seconds}s`}</span>}
                    {run.judge_model && run.judge_model !== run.ollama_model && <span style={{ fontSize: 10, color: t.muted, fontFamily: 'monospace' }}>⚖ {run.judge_model.split(':')[0]}</span>}
                  </div>
                </div>
                {expandedRun === run.id && expandedRunData && (
                  <div style={{ padding: '10px 12px', border: `1px solid ${t.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', display: 'flex', flexDirection: 'column', gap: 8, background: t.surface2 }}>
                    <div style={{ display: 'flex', gap: 10, fontSize: 12, paddingBottom: 8, borderBottom: `1px solid ${t.border}`, flexWrap: 'wrap' }}>
                      <span>🤖 <strong>{expandedRunData.score_avg}/10</strong></span>
                      {expandedRunData.human_score_avg != null && <span>👤 <strong>{expandedRunData.human_score_avg}/10</strong></span>}
                      {expandedRunData.ollama_model && <span style={{ color: t.muted, fontSize: 10, fontFamily: 'monospace' }}>{expandedRunData.ollama_model}</span>}
                      {expandedRunData.judge_model && <span style={{ color: t.muted, fontSize: 10, fontFamily: 'monospace' }}>judge: {expandedRunData.judge_model}</span>}
                    </div>
                    {expandedRunData.results.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, paddingBottom: 8, borderBottom: i < expandedRunData.results.length - 1 ? `1px solid ${t.border}` : 'none' }}>
                        <div style={{ fontWeight: 500, marginBottom: 3 }}>Q: {r.question}</div>
                        <div style={{ color: t.muted, marginBottom: 2, fontSize: 11 }}>Expected: {r.expected_answer}</div>
                        <div style={{ marginBottom: 5, fontSize: 11 }}>Got: {r.actual_answer}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                          <div style={{ flex: 1 }}><span style={{ fontSize: 10, color: t.muted }}>🤖 </span><ScoreBar score={r.score} t={t} /></div>
                          {r.human_score != null && <div style={{ flex: 1 }}><span style={{ fontSize: 10, color: t.muted }}>👤 </span><ScoreBar score={r.human_score} t={t} /></div>}
                        </div>
                        <ThumbsButtons resultId={r.id} humanScore={r.human_score} onVote={handleVote} t={t} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom: Live Logs (full width) ────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${t.border}`, background: t.surface, flexShrink: 0 }}>
        <div style={{ padding: '10px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div onClick={() => setLogsCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Live Logs</span>
            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: logConnected ? '#16a34a22' : '#dc262622', color: logConnected ? t.up : t.down }}>
              {logConnected ? '● live' : '○ reconnecting'}
            </span>
            <span style={{ fontSize: 11, color: t.muted }}>{logsCollapsed ? '▼' : '▲'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {['all', 'backend', 'ollama', 'postgres'].map(f => (
              <button key={f} onClick={() => setLogFilter(f)} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: `1px solid ${logFilter === f ? (SERVICE_COLORS[f] || t.border) : t.border}`, background: logFilter === f ? (SERVICE_COLORS[f] ? SERVICE_COLORS[f] + '22' : t.surface2) : 'transparent', color: logFilter === f ? (SERVICE_COLORS[f] || t.text) : t.muted }}>{f}</button>
            ))}
            <button onClick={() => setLogPaused(p => !p)} style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: logPaused ? t.accent : 'transparent', color: logPaused ? '#fff' : t.text, fontSize: 11, cursor: 'pointer' }}>{logPaused ? '▶ Resume' : '⏸ Pause'}</button>
            <button onClick={() => setLogLines([])} style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid ${t.border}`, background: 'transparent', color: t.muted, fontSize: 11, cursor: 'pointer' }}>Clear</button>
          </div>
        </div>
        {!logsCollapsed && (
          <div ref={logContainerRef} style={{ height: 200, overflowY: 'auto', background: t.logBg, borderTop: `1px solid ${t.border}`, padding: '8px 24px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
            {visibleLines.length === 0 && <span style={{ color: t.muted }}>Waiting for logs...</span>}
            {visibleLines.map(({ id, service, line }) => (
              <div key={id} style={{ display: 'flex', gap: 8, wordBreak: 'break-all' }}>
                <span style={{ color: SERVICE_COLORS[service], flexShrink: 0, userSelect: 'none' }}>[{service}]</span>
                <span style={{ color: t.text }}>{line}</span>
              </div>
            ))}
          </div>
        )}
        {logPaused && <p style={{ fontSize: 11, color: t.muted, padding: '4px 24px 8px' }}>⏸ Paused — {logLines.length} lines buffered.</p>}
      </div>

    </div>
  )
}