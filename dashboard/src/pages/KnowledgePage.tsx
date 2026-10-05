import { useCallback, useEffect, useState } from 'react'
import { AnswerInput } from '../components/AnswerInput'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { CONTRACT_TYPES } from '../domain/constants'
import { humanize } from '../domain/format'
import { ANSWER_TYPES, KNOWLEDGE_CATEGORIES, formatAnswer, knowledgeFieldsSchema, type AnswerType, type AnswerValue, type KnowledgeEntry, type Restriction } from '../domain/knowledge'

type Draft = {
  id: string | null; revision: string | null; concept: string; question: string; language: string; category: string; type: AnswerType; answer: AnswerValue | null
  country: string; location: string; contractType: string; linked: Restriction[]; aliases: string; confirmed: boolean
}
const EDITABLE_SCOPES = ['COUNTRY', 'LOCATION', 'CONTRACT_TYPE']
const emptyDraft: Draft = { id: null, revision: null, concept: '', question: '', language: 'en', category: 'other', type: 'text', answer: null, country: '', location: '', contractType: '', linked: [], aliases: '', confirmed: true }

function draftFrom(entry: KnowledgeEntry): Draft {
  const value = (type: string) => entry.context.find(item => item.type === type)?.value ?? ''
  return { id: entry.id, revision: entry.revision, concept: entry.concept, question: entry.question, language: entry.language, category: entry.category, type: entry.answer.type, answer: entry.answer,
    country: value('COUNTRY'), location: value('LOCATION'), contractType: value('CONTRACT_TYPE'), linked: entry.context.filter(item => !EDITABLE_SCOPES.includes(item.type)),
    aliases: entry.aliases.join('\n'), confirmed: entry.confirmed }
}
function fieldsFrom(draft: Draft) {
  const context = [...draft.linked, ...[['COUNTRY', draft.country], ['LOCATION', draft.location], ['CONTRACT_TYPE', draft.contractType]].filter(([, value]) => value.trim()).map(([type, value]) => ({ type, value }))]
  // A comma still being typed leaves an empty last item in the draft.
  const answer = draft.answer?.type === 'multi_select' ? { ...draft.answer, value: draft.answer.value.filter(item => item.trim()) } : draft.answer
  return { concept: draft.concept, question: draft.question, language: draft.language, category: draft.category, answer, context,
    aliases: draft.aliases.split('\n').map(line => line.trim()).filter(Boolean), confirmed: draft.confirmed }
}
function scopeLabel(context: Restriction[], applications: LiveApplication[]) {
  if (!context.length) return 'Global'
  const linked = (item: Restriction) => {
    if (item.type === 'APPLICATION') return applications.find(a => a.id === item.value)?.slug
    if (item.type === 'JOB') return applications.find(a => a.jobId === item.value)?.data.role
    if (item.type === 'COMPANY') return applications.find(a => a.companyId === item.value)?.data.company
    return item.value
  }
  return context.map(item => `${humanize(item.type.toLowerCase())}: ${linked(item) ?? 'removed record'}`).join(' · ')
}

export function KnowledgePage() {
  const { applications } = useApplications()
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useUnsavedGuard(draft !== null)
  const load = useCallback(async () => {
    try { setEntries((await request<{ entries: KnowledgeEntry[] }>('/knowledge')).entries) }
    catch (e) { setMessage((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])
  const set = (changes: Partial<Draft>) => setDraft(current => current && { ...current, ...changes })

  async function save(current: Draft) {
    const parsed = knowledgeFieldsSchema.safeParse(fieldsFrom(current))
    if (!parsed.success) { setMessage(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return }
    setBusy(true); setMessage('')
    try {
      if (current.id) await request(`/knowledge/${current.id}`, 'PUT', { ...parsed.data, revision: current.revision })
      else await request('/knowledge', 'POST', parsed.data)
      setDraft(null); setMessage('Answer saved.'); await load()
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function remove(entry: KnowledgeEntry) {
    if (!window.confirm(`Remove the answer for "${entry.concept}"?`)) return
    setMessage('')
    try { await request(`/knowledge/${entry.id}`, 'DELETE', { revision: entry.revision }); setMessage('Answer removed.') }
    catch (e) { setMessage((e as Error).message) }
    await load()
  }

  const wanted = search.trim().toLowerCase()
  const visible = entries.filter(entry => (!category || entry.category === category)
    && [entry.concept, entry.question, formatAnswer(entry.answer), ...entry.aliases].some(text => text.toLowerCase().includes(wanted)))
  return <article className="detail">
    <h1>Knowledge Base</h1>
    <p className="muted">Reusable answers to recurring application questions. An answer is only reused when its language and every restriction match the application.</p>
    <div className="toolbar">
      <input type="search" placeholder="Search" aria-label="Search answers" value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{humanize(c)}</option>)}</select>
      <button disabled={busy} onClick={() => { if (confirmDiscard(draft !== null)) { setDraft(emptyDraft); setMessage('') } }}>New answer</button>
    </div>
    <p role="status">{message}</p>
    {draft && <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void save(draft) }}>
      <fieldset disabled={busy}><legend>{draft.id ? 'Edit answer' : 'New answer'}</legend><div className="form-grid">
        <label>Concept (e.g. experience.symfony)<input value={draft.concept} onChange={e => set({ concept: e.target.value })} /></label>
        <label>Category<select value={draft.category} onChange={e => set({ category: e.target.value })}>{KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{humanize(c)}</option>)}</select></label>
        <label>Language code (e.g. en)<input value={draft.language} onChange={e => set({ language: e.target.value })} /></label>
        <label>Answer type<select value={draft.type} onChange={e => set({ type: e.target.value as AnswerType, answer: null })}>{ANSWER_TYPES.map(t => <option key={t} value={t}>{humanize(t)}</option>)}</select></label>
      </div>
      <label>Reference question<input value={draft.question} onChange={e => set({ question: e.target.value })} /></label>
      <AnswerInput type={draft.type} options={[]} value={draft.answer} onChange={answer => set({ answer })} />
      <label>Equivalent questions (one per line; only add wordings with exactly the same meaning)<textarea rows={3} value={draft.aliases} onChange={e => set({ aliases: e.target.value })} /></label>
      <fieldset><legend>Restrictions (empty means global)</legend><div className="form-grid">
        <label>Country code<input value={draft.country} onChange={e => set({ country: e.target.value })} /></label>
        <label>Location<input value={draft.location} onChange={e => set({ location: e.target.value })} /></label>
        <label>Contract type<select value={draft.contractType} onChange={e => set({ contractType: e.target.value })}><option value="">Any</option>{CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
      </div>{draft.linked.length > 0 && <p className="muted">Also limited to {scopeLabel(draft.linked, applications)}.</p>}</fieldset>
      <label><input type="checkbox" checked={draft.confirmed} onChange={e => set({ confirmed: e.target.checked })} />I confirm this answer is correct (unconfirmed answers are never reused)</label>
      <div className="toolbar"><button disabled={busy}>{busy ? 'Saving…' : 'Save answer'}</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>
      </fieldset>
    </form>}
    {visible.length === 0 && <p className="muted">No answers found.</p>}
    {visible.map(entry => <section className="detail-section" key={entry.id}>
      <h2>{entry.concept} · {humanize(entry.category)} · {entry.language}</h2>
      <p>{entry.question}</p>
      <p><strong>{formatAnswer(entry.answer)}</strong></p>
      <p className="muted">{scopeLabel(entry.context, applications)} · Origin: {humanize(entry.origin.toLowerCase())} · {entry.confirmedAt ? `Reviewed ${new Date(entry.confirmedAt).toLocaleDateString()}` : 'Not confirmed'}
        {entry.aliases.length > 0 && ` · ${entry.aliases.length} equivalent question(s)`}</p>
      <div className="toolbar"><button disabled={busy} onClick={() => { if (confirmDiscard(draft !== null)) { setDraft(draftFrom(entry)); setMessage('') } }}>Edit</button>
        <button disabled={busy} onClick={() => void remove(entry)}>Remove</button></div>
    </section>)}
  </article>
}
