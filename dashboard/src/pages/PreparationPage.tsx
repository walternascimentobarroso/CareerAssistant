import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AnswerInput } from '../components/AnswerInput'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type Cv, type LiveApplication } from '../data/loadApplications'
import { humanize } from '../domain/format'
import { ANSWER_TYPES, KNOWLEDGE_CATEGORIES, SCOPE_TYPES, formatAnswer, type AnswerType, type AnswerValue, type ScopeType } from '../domain/knowledge'
import { PROFILE_CONCEPTS, answerFits, preparationSummary, type Approval, type Preparation, type PreparationAnswer } from '../domain/applicationPreparation'

type Loaded = { preparation: Preparation }
type Context = { country: string; language: string; cvRequired: boolean }
type Draft = {
  id: string | null; question: string; concept: string; type: AnswerType; options: string; required: boolean; answer: AnswerValue | null
  accept: boolean; remember: boolean; rememberConcept: string; category: string; scopes: ScopeType[]
}
// A remembered answer stays with this application unless a wider scope is chosen.
const emptyDraft: Draft = { id: null, question: '', concept: '', type: 'text', options: '', required: true, answer: null, accept: false, remember: false, rememberConcept: '', category: 'other', scopes: ['APPLICATION'] }
const draftFrom = (answer: PreparationAnswer): Draft => ({ ...emptyDraft, id: answer.id, question: answer.question, concept: answer.concept ?? '', type: answer.type, options: answer.options.join('\n'),
  required: answer.required, answer: answer.answer, accept: answer.approval === 'accepted', rememberConcept: answer.concept ?? answer.evidence?.concept ?? '' })
const optionsOf = (draft: Draft) => draft.options.split('\n').map(line => line.trim()).filter(Boolean)
const requirementOf = (draft: Draft) => ({ question: draft.question, concept: draft.concept.trim() || null, type: draft.type, options: optionsOf(draft), required: draft.required })
const contextOf = (preparation: Preparation): Context => ({ country: preparation.country ?? '', language: preparation.language, cvRequired: preparation.cvRequired })

export function PreparationPage() {
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">Application not found.</p>
  return <PreparationWorkspace application={application} key={application.slug} />
}

function PreparationWorkspace({ application }: { application: LiveApplication }) {
  const [preparation, setPreparation] = useState<Preparation | null>(null)
  const [context, setContext] = useState<Context | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [cvs, setCvs] = useState<Cv[]>([])
  const [cvVersionId, setCvVersionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const contextDirty = !!preparation && !!context && JSON.stringify(context) !== JSON.stringify(contextOf(preparation))
  useUnsavedGuard(draft !== null || contextDirty)

  /** Returns whether the change was stored; a failure keeps every draft on screen. */
  async function run(action: () => Promise<Loaded>, done = '') {
    setBusy(true); setMessage('')
    try {
      const loaded = (await action()).preparation
      setPreparation(loaded); setConflict(false); setMessage(done)
      return loaded
    } catch (e) {
      const failure = e as Error & { status?: number }
      setMessage(failure.message); setConflict(failure.status === 409)
      return null
    } finally { setBusy(false) }
  }
  const load = () => run(() => request<Loaded>(`/applications/${application.slug}/preparations`, 'POST', {}))
  useEffect(() => {
    void load().then(loaded => { if (loaded) setContext(contextOf(loaded)) })
    void request<Cv[]>('/cvs').then(setCvs).catch(e => setMessage(e.message))
  }, [])
  if (!preparation || !context) return <article className="detail"><p role="status">{message || 'Loading preparation…'}</p>{message && <button onClick={() => void load().then(loaded => { if (loaded) setContext(contextOf(loaded)) })}>Retry</button>}</article>

  const path = `/preparations/${preparation.id}`
  const revision = preparation.revision
  const summary = preparationSummary(preparation)
  const set = (changes: Partial<Draft>) => setDraft(current => current && { ...current, ...changes })
  const versions = [...(preparation.cv ? [preparation.cv] : []), ...(application.cvHistory ?? []).map(cv => ({ versionId: cv.versionId, name: cv.name, version: cv.version })),
    ...cvs.flatMap(cv => cv.versionId && cv.version !== undefined ? [{ versionId: cv.versionId, name: cv.name, version: cv.version }] : [])]
    .filter((cv, index, all) => all.findIndex(other => other.versionId === cv.versionId) === index)
  const selectedCvVersionId = cvVersionId || preparation.cv?.versionId || ''

  async function saveContext(current: Context) {
    const saved = await run(() => request<Loaded>(path, 'PUT', { country: current.country.trim() || null, language: current.language, cvRequired: current.cvRequired, revision }), 'Context saved.')
    if (saved) setContext(contextOf(saved))
  }
  async function saveDraft(current: Draft) {
    const saved = current.id === null
      ? await run(() => request<Loaded>(`${path}/answers`, 'POST', { ...requirementOf(current), revision }), 'Question added.')
      : await run(() => request<Loaded>(`${path}/answers/${current.id}`, 'PUT', { ...requirementOf(current), answer: current.answer, approval: current.accept ? 'accepted' : 'pending', revision,
        remember: current.remember ? { concept: current.rememberConcept, category: current.category, scopes: current.scopes } : undefined }), 'Answer saved.')
    if (saved) setDraft(null)
  }
  const review = (answer: PreparationAnswer, approval: Approval, value = answer.answer) => run(() => request<Loaded>(`${path}/answers/${answer.id}`, 'PUT',
    { question: answer.question, concept: answer.concept, type: answer.type, options: answer.options, required: answer.required, answer: value, approval, revision }))
  function remove(answer: PreparationAnswer) {
    if (window.confirm(`Remove "${answer.question}"?`)) void run(() => request<Loaded>(`${path}/answers/${answer.id}`, 'DELETE', { revision }))
  }

  return <article className="detail">
    <Link to={`/applications/${application.slug}`} className="back">← {application.data.company}</Link>
    <header><h1>Prepare application</h1><p className="detail-role">{application.data.company} · {application.data.role}</p></header>
    <p role="status">{message}</p>
    {conflict && <button disabled={busy} onClick={() => void load()}>Load current version</button>}

    <section className="detail-section"><h2>Summary</h2>
      <p><span className="badge status">{humanize(summary.status.toLowerCase())}</span></p>
      {summary.completeness === null ? <p>No required items listed yet.</p>
        : <p>{summary.accepted} of {summary.total} known required items accepted ({summary.completeness}%) · {summary.pending} to review · {summary.missing} missing</p>}
      <p>CV: {preparation.cv ? `${preparation.cv.name} v${preparation.cv.version}` : preparation.cvRequired ? 'not selected' : 'not required'}</p>
      {!preparation.formInspected && <p className="muted">Form not inspected. The percentage covers only the items listed here, not the questions the real form may ask. Automatic submission is not available.</p>}
    </section>

    <form className="application-form" onSubmit={e => { e.preventDefault(); void saveContext(context) }}><fieldset disabled={busy}><legend>Application context</legend>
      <div className="form-grid">
        <label>Job country (ISO code, e.g. DE)<input value={context.country} onChange={e => setContext({ ...context, country: e.target.value })} /></label>
        <label>Form language (e.g. en)<input value={context.language} onChange={e => setContext({ ...context, language: e.target.value })} /></label>
      </div>
      <label><input type="checkbox" checked={context.cvRequired} onChange={e => setContext({ ...context, cvRequired: e.target.checked })} />A CV is required</label>
      <p className="muted">Location: {application.data.location ?? 'unknown'} · Contract: {application.data.type ?? 'unknown'}. Changing country or language sends reused answers back to review.</p>
      <button disabled={!contextDirty}>Save context</button>
    </fieldset></form>

    <section className="detail-section"><h2>CV version</h2>
      <div className="inline-form">
        <label>Version to send<select value={selectedCvVersionId} disabled={busy} onChange={e => setCvVersionId(e.target.value)}><option value="">Select a version</option>
          {versions.map(cv => <option key={cv.versionId} value={cv.versionId}>{cv.name} v{cv.version}</option>)}</select></label>
        <button disabled={busy || !selectedCvVersionId} onClick={() => void run(() => request<Loaded>(`${path}/select-cv`, 'POST', { cvVersionId: selectedCvVersionId, revision }), 'CV version fixed. Later CV edits do not change it.')}>Use this version</button>
      </div>
    </section>

    <section className="detail-section"><h2>Questions and requirements</h2>
      <div className="toolbar">
        <button disabled={busy || draft !== null} onClick={() => setDraft(emptyDraft)}>Add question</button>
        <button disabled={busy || draft !== null} onClick={() => void run(() => request<Loaded>(`${path}/resolve`, 'POST', { revision }), 'Open questions resolved from the profile and knowledge base.')}>Resolve answers</button>
      </div>
      {preparation.answers.length === 0 && <p className="muted">No questions yet. Add the ones you know the form asks.</p>}
      {preparation.answers.map(answer => draft?.id === answer.id ? null : <div className="note-form" key={answer.id}>
        <p><strong>{answer.question}</strong></p>
        <div className="badges">
          <span className="badge">{answer.required ? 'Required' : 'Optional'}</span><span className="badge">{humanize(answer.type)}</span>
          <span className="badge">{humanize(answer.approval)}</span><span className="badge">Source: {humanize(answer.source.toLowerCase())}</span>
          <span className="badge">Confidence: {humanize(answer.confidence.toLowerCase())}</span>
        </div>
        <p>{formatAnswer(answer.answer)}</p>
        {answer.reviewReason && <p role="alert">{answer.reviewReason}</p>}
        {answer.evidence?.sources.map(source => <p className="muted" key={source.kind + source.id}>{humanize(source.kind.toLowerCase())} (revision {source.revision}) — {source.label}: {formatAnswer(source.answer)}
          {!answer.answer && answerFits(answer, source.answer) && <> <button disabled={busy} onClick={() => void review(answer, 'accepted', source.answer)}>Use this answer</button></>}</p>)}
        <div className="toolbar">
          {answer.answer && answer.approval !== 'accepted' && <button disabled={busy} onClick={() => void review(answer, 'accepted')}>Accept</button>}
          {answer.answer && answer.approval !== 'rejected' && <button disabled={busy} onClick={() => void review(answer, 'rejected')}>Reject</button>}
          <button disabled={busy || draft !== null} onClick={() => setDraft(draftFrom(answer))}>Edit</button>
          <button disabled={busy} onClick={() => remove(answer)}>Remove</button>
        </div>
      </div>)}
    </section>

    {draft && <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void saveDraft(draft) }}><fieldset disabled={busy}><legend>{draft.id ? 'Edit question' : 'New question'}</legend>
      <label>Question<input value={draft.question} onChange={e => set({ question: e.target.value })} /></label>
      <div className="form-grid">
        <label>Concept (optional; otherwise matched by wording)<input list="known-concepts" value={draft.concept} onChange={e => set({ concept: e.target.value })} /></label>
        <label>Answer type<select value={draft.type} onChange={e => set({ type: e.target.value as AnswerType, answer: null, accept: false })}>{ANSWER_TYPES.map(type => <option key={type} value={type}>{humanize(type)}</option>)}</select></label>
      </div>
      <datalist id="known-concepts">{PROFILE_CONCEPTS.map(concept => <option key={concept} value={concept} />)}</datalist>
      {(draft.type === 'single_select' || draft.type === 'multi_select') && <label>Options (one per line)<textarea rows={3} value={draft.options} onChange={e => set({ options: e.target.value, answer: null, accept: false })} /></label>}
      <label><input type="checkbox" checked={draft.required} onChange={e => set({ required: e.target.checked })} />Required</label>
      {draft.id && <>
        <AnswerInput type={draft.type} options={optionsOf(draft)} value={draft.answer} onChange={answer => set({ answer })} />
        <label><input type="checkbox" checked={draft.accept} onChange={e => set({ accept: e.target.checked, remember: draft.remember && e.target.checked })} />Accept this answer</label>
        <label><input type="checkbox" checked={draft.remember} disabled={!draft.accept} onChange={e => set({ remember: e.target.checked })} />Remember this answer</label>
        {draft.remember && <fieldset><legend>Reusable answer</legend><div className="form-grid">
          <label>Concept<input value={draft.rememberConcept} onChange={e => set({ rememberConcept: e.target.value })} /></label>
          <label>Category<select value={draft.category} onChange={e => set({ category: e.target.value })}>{KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{humanize(c)}</option>)}</select></label>
        </div>
        <p>Reuse only when all of these match this application:</p>
        {SCOPE_TYPES.map(scope => <label key={scope}><input type="checkbox" checked={draft.scopes.includes(scope)} onChange={e => set({ scopes: e.target.checked ? [...draft.scopes, scope] : draft.scopes.filter(s => s !== scope) })} />{humanize(scope.toLowerCase())}</label>)}
        {draft.scopes.length === 0 && <p role="alert">No restriction: this answer will be reused in every application.</p>}
        </fieldset>}
      </>}
      <div className="toolbar"><button>{busy ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => { if (confirmDiscard(true)) setDraft(null) }}>Cancel</button></div>
    </fieldset></form>}
  </article>
}
