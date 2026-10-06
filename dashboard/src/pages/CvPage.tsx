import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, type Cv } from '../data/loadApplications'

export function CvPage() {
  const { t } = useTranslation('pages')
  const [origin, setOrigin] = useState('')
  const [versions, setVersions] = useState<{ id:string; version:number; content:string }[]>([])
  const [cvs, setCvs] = useState<Cv[]>([])
  const [selected, setSelected] = useState<Cv | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const load = async () => setCvs(await request<Cv[]>('/cvs'))
  useEffect(() => { void load().catch(e => setMessage(e.message)) }, [])
  useUnsavedGuard(dirty)
  function choose(cv: Cv | null) {
    if (!confirmDiscard(dirty)) return
    setVersions([]); setOrigin('')
    if (cv) void request<{ id:string; version:number; content:string }[]>(`/cvs/${cv.name}/versions`).then(setVersions).catch(e => setMessage(e.message))
    setSelected(cv); setName(cv?.name ?? ''); setContent(cv?.content ?? ''); setDirty(false); setMessage('')
  }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const saved = await request<Cv>(selected ? `/cvs/${selected.name}` : '/cvs', selected ? 'PUT' : 'POST', selected ? { content, revision: selected.revision } : { name, content, ...(origin && { derivedFromVersionId:origin }) })
      setSelected(saved); setDirty(false); await load(); setVersions(await request(`/cvs/${saved.name}/versions`)); setMessage(t('cv.saved_version', { version: saved.version }))
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function reloadSelected() {
    if (dirty && !window.confirm(t('cv.discard_unsaved_changes_and_reload_from_postgresql'))) return
    try { const fresh = selected ? await request<Cv>(`/cvs/${selected.name}`) : null; setSelected(fresh); setContent(fresh?.content ?? ''); setDirty(false); await load(); setMessage(t('cv.reloaded')) }
    catch (e) { setMessage((e as Error).message) }
  }
  return <article className="detail cv-manager">
    <h1>{t('cv.cvs')}</h1>
    <p>{t('cv.history_hint')}</p>
    <div className="toolbar"><button disabled={busy} onClick={() => choose(null)}>{t('cv.new_cv')}</button>{cvs.map(cv => <button key={cv.name} disabled={busy} aria-pressed={selected?.name === cv.name} onClick={() => choose(cv)}>{cv.name}</button>)}</div>
    <label>{t('cv.name')}<input value={name} disabled={!!selected || busy} placeholder="master, backend, devops…" pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={e => { setName(e.target.value); setDirty(true) }} /></label>
    {!selected && <label>{t('cv.derived_from')}<select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">{t('cv.no_known_origin')}</option>{cvs.map(cv=><option key={cv.name} value={cv.versionId}>{cv.name} v{cv.version}</option>)}</select></label>}
    {selected && <details><summary>{t('cv.version_history', { version: selected.version })}</summary>{versions.map(version=><div key={version.id} className="toolbar"><span>v{version.version}</span><button disabled={busy} onClick={()=>{if(confirmDiscard(dirty)){setContent(version.content);setDirty(true)}}}>{t('cv.load_content_into_editor')}</button></div>)}</details>}
    <label>{t('cv.import_markdown_or_plain_text')}<input type="file" accept=".md,.txt,text/plain,text/markdown" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]
      if (!file) return
      if (file.size > 1_000_000) { setMessage(t('cv.file_too_large_maximum_1_mb')); return }
      if (dirty && !window.confirm(t('cv.replace_unsaved_editor_content_with_this_file'))) return
      try { setContent(await file.text()); setDirty(true) } catch { setMessage(t('cv.unable_to_read_file')) }
      e.target.value = ''
    }} /></label>
    <div className="cv-columns"><label>{t('cv.markdown')}<textarea rows={24} value={content} disabled={busy} onChange={e => { setContent(e.target.value); setDirty(true) }} /></label><div className="markdown"><Markdown>{content}</Markdown></div></div>
    <div className="toolbar"><button disabled={busy || !content.trim() || !name} onClick={() => void save()}>{busy ? t('saving', { ns: 'common' }) : t('cv.save_cv')}</button><button disabled={busy} onClick={() => void reloadSelected()}>{t('reload', { ns: 'common' })}</button>{dirty && <span>{t('unsaved_changes', { ns: 'common' })}</span>}</div>
    <p role="status">{message}</p>
  </article>
}
