import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { request, type Cv } from '../data/loadApplications'

export function CvPage() {
  const [cvs, setCvs] = useState<Cv[]>([])
  const [selected, setSelected] = useState<Cv | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const load = async () => setCvs(await request<Cv[]>('/cvs'))
  useEffect(() => { void load().catch(e => setMessage(e.message)) }, [])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    const navigate = (e: MouseEvent) => {
      if (dirty && e.target instanceof Element && e.target.closest('a[href]') && !window.confirm('Discard unsaved CV changes?')) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', navigate, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', navigate, true) }
  }, [dirty])
  function choose(cv: Cv | null) {
    if (dirty && !window.confirm('Discard unsaved CV changes?')) return
    setSelected(cv); setName(cv?.name ?? ''); setContent(cv?.content ?? ''); setDirty(false); setMessage('')
  }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const saved = await request<Cv>(selected ? `/cvs/${selected.name}` : '/cvs', selected ? 'PUT' : 'POST', selected ? { content, revision: selected.revision } : { name, content })
      setSelected(saved); setDirty(false); await load(); setMessage('Saved.')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function reloadSelected() {
    if (dirty && !window.confirm('Discard unsaved changes and reload from disk?')) return
    try { const fresh = selected ? await request<Cv>(`/cvs/${selected.name}`) : null; setSelected(fresh); setContent(fresh?.content ?? ''); setDirty(false); await load(); setMessage('Reloaded.') }
    catch (e) { setMessage((e as Error).message) }
  }
  return <article className="detail cv-manager">
    <h1>CVs</h1>
    <p>Maintain your complete history in master first. Base CVs should only use facts from master. Application copies remain independent.</p>
    <div className="toolbar"><button disabled={busy} onClick={() => choose(null)}>New CV</button>{cvs.map(cv => <button key={cv.name} disabled={busy} aria-pressed={selected?.name === cv.name} onClick={() => choose(cv)}>{cv.name}</button>)}</div>
    <label>Name<input value={name} disabled={!!selected || busy} placeholder="master, backend, devops…" pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={e => { setName(e.target.value); setDirty(true) }} /></label>
    <label>Import Markdown or plain text<input type="file" accept=".md,.txt,text/plain,text/markdown" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]
      if (!file) return
      if (file.size > 1_000_000) { setMessage('File too large (maximum 1 MB).'); return }
      if (dirty && !window.confirm('Replace unsaved editor content with this file?')) return
      try { setContent(await file.text()); setDirty(true) } catch { setMessage('Unable to read file.') }
      e.target.value = ''
    }} /></label>
    <div className="cv-columns"><label>Markdown<textarea rows={24} value={content} disabled={busy} onChange={e => { setContent(e.target.value); setDirty(true) }} /></label><div className="markdown"><Markdown>{content}</Markdown></div></div>
    <div className="toolbar"><button disabled={busy || !content.trim() || !name} onClick={() => void save()}>{busy ? 'Saving…' : 'Save CV'}</button><button disabled={busy} onClick={() => void reloadSelected()}>Reload from disk</button>{dirty && <span>Unsaved changes</span>}</div>
    <p role="status">{message}</p>
  </article>
}
