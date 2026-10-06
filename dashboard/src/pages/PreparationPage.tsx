import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CONTRACT_TYPE_LABELS } from '../domain/constants'
import { AnswerInput } from '../components/AnswerInput'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type Cv, type LiveApplication } from '../data/loadApplications'
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
  const { t } = useTranslation('pages')
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">{t('application_not_found', { ns: 'common' })}</p>
  return <PreparationWorkspace application={application} key={application.slug} />
}

function PreparationWorkspace({ application }: { application: LiveApplication }) {
  const { t } = useTranslation('pages')
  const displayAnswer = (answer: AnswerValue | null) => {
    if (answer?.type === 'boolean') return t(answer.value ? 'yes' : 'no', { ns: 'common' })
    if (answer?.type === 'money') return `${answer.amount} ${answer.currency}/${t(`rate_period.${answer.period}`, { ns: 'common' })}`
    return formatAnswer(answer)
  }
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
  if (!preparation || !context) return <article className="detail"><p role="status">{message || t('preparation.loading_preparation')}</p>{message && <button onClick={() => void load().then(loaded => { if (loaded) setContext(contextOf(loaded)) })}>{t('retry', { ns: 'common' })}</button>}</article>

  const path = `/preparations/${preparation.id}`
  const revision = preparation.revision
  const summary = preparationSummary(preparation)
  const set = (changes: Partial<Draft>) => setDraft(current => current && { ...current, ...changes })
  const versions = [...(preparation.cv ? [preparation.cv] : []), ...(application.cvHistory ?? []).map(cv => ({ versionId: cv.versionId, name: cv.name, version: cv.version })),
    ...cvs.flatMap(cv => cv.versionId && cv.version !== undefined ? [{ versionId: cv.versionId, name: cv.name, version: cv.version }] : [])]
    .filter((cv, index, all) => all.findIndex(other => other.versionId === cv.versionId) === index)
  const selectedCvVersionId = cvVersionId || preparation.cv?.versionId || ''

  async function saveContext(current: Context) {
    const saved = await run(() => request<Loaded>(path, 'PUT', { country: current.country.trim() || null, language: current.language, cvRequired: current.cvRequired, revision }), t('preparation.context_saved'))
    if (saved) setContext(contextOf(saved))
  }
  async function saveDraft(current: Draft) {
    const saved = current.id === null
      ? await run(() => request<Loaded>(`${path}/answers`, 'POST', { ...requirementOf(current), revision }), t('preparation.question_added'))
      : await run(() => request<Loaded>(`${path}/answers/${current.id}`, 'PUT', { ...requirementOf(current), answer: current.answer, approval: current.accept ? 'accepted' : 'pending', revision,
        remember: current.remember ? { concept: current.rememberConcept, category: current.category, scopes: current.scopes } : undefined }), t('preparation.answer_saved'))
    if (saved) setDraft(null)
  }
  const review = (answer: PreparationAnswer, approval: Approval, value = answer.answer) => run(() => request<Loaded>(`${path}/answers/${answer.id}`, 'PUT',
    { question: answer.question, concept: answer.concept, type: answer.type, options: answer.options, required: answer.required, answer: value, approval, revision }))
  function remove(answer: PreparationAnswer) {
    if (window.confirm(t('preparation.confirm_remove', { question: answer.question }))) void run(() => request<Loaded>(`${path}/answers/${answer.id}`, 'DELETE', { revision }))
  }

  return <article className="detail">
    <Link to={`/applications/${application.slug}`} className="back">← {application.data.company}</Link>
    <header><h1>{t('preparation.prepare_application')}</h1><p className="detail-role">{application.data.company} · {application.data.role}</p></header>
    <p role="status">{message}</p>
    {conflict && <button disabled={busy} onClick={() => void load()}>{t('load_current_version', { ns: 'common' })}</button>}

    <section className="detail-section"><h2>{t('preparation.summary')}</h2>
      <p><span className="badge status">{t(`preparation.labels.status.${summary.status.toLowerCase()}`)}</span></p>
      {summary.completeness === null ? <p>{t('preparation.no_required_items_listed_yet')}</p>
        : <p>{t('preparation.completeness', { accepted: summary.accepted, total: summary.total, percentage: summary.completeness, pending: summary.pending, missing: summary.missing })}</p>}
      <p>{t('preparation.cv_summary', { version: preparation.cv ? `${preparation.cv.name} v${preparation.cv.version}` : preparation.cvRequired ? t('preparation.not_selected') : t('preparation.not_required') })}</p>
      {!preparation.formInspected && <p className="muted">{t('preparation.form_not_inspected_hint')}</p>}
    </section>

    <form className="application-form" onSubmit={e => { e.preventDefault(); void saveContext(context) }}><fieldset disabled={busy}><legend>{t('preparation.application_context')}</legend>
      <div className="form-grid">
        <label>{t('preparation.job_country_iso_code_e_g_de')}<input value={context.country} onChange={e => setContext({ ...context, country: e.target.value })} /></label>
        <label>{t('preparation.form_language_e_g_en')}<input value={context.language} onChange={e => setContext({ ...context, language: e.target.value })} /></label>
      </div>
      <label><input type="checkbox" checked={context.cvRequired} onChange={e => setContext({ ...context, cvRequired: e.target.checked })} />{t('preparation.a_cv_is_required')}</label>
      <p className="muted">{t('preparation.context_hint', { location: application.data.location ?? t('preparation.unknown'), contract: application.data.type ? t(CONTRACT_TYPE_LABELS[application.data.type], { ns: 'status' }) : t('preparation.unknown') })}</p>
      <button disabled={!contextDirty}>{t('preparation.save_context')}</button>
    </fieldset></form>

    <section className="detail-section"><h2>{t('preparation.cv_version')}</h2>
      <div className="inline-form">
        <label>{t('preparation.version_to_send')}<select value={selectedCvVersionId} disabled={busy} onChange={e => setCvVersionId(e.target.value)}><option value="">{t('preparation.select_a_version')}</option>
          {versions.map(cv => <option key={cv.versionId} value={cv.versionId}>{cv.name} v{cv.version}</option>)}</select></label>
        <button disabled={busy || !selectedCvVersionId} onClick={() => void run(() => request<Loaded>(`${path}/select-cv`, 'POST', { cvVersionId: selectedCvVersionId, revision }), t('preparation.cv_version_fixed_later_cv_edits_do_not_change_it'))}>{t('preparation.use_this_version')}</button>
      </div>
    </section>

    <section className="detail-section"><h2>{t('preparation.questions_and_requirements')}</h2>
      <div className="toolbar">
        <button disabled={busy || draft !== null} onClick={() => setDraft(emptyDraft)}>{t('preparation.add_question')}</button>
        <button disabled={busy || draft !== null} onClick={() => void run(() => request<Loaded>(`${path}/resolve`, 'POST', { revision }), t('preparation.answers_resolved'))}>{t('preparation.resolve_answers')}</button>
      </div>
      {preparation.answers.length === 0 && <p className="muted">{t('preparation.no_questions_yet_add_the_ones_you_know_the_form_asks')}</p>}
      {preparation.answers.map(answer => draft?.id === answer.id ? null : <div className="note-form" key={answer.id}>
        <p><strong>{answer.question}</strong></p>
        <div className="badges">
          <span className="badge">{answer.required ? t('preparation.required') : t('preparation.optional')}</span><span className="badge">{t(`preparation.labels.answer_type.${answer.type}`)}</span>
          <span className="badge">{t(`preparation.labels.approval.${answer.approval}`)}</span><span className="badge">{t('preparation.source_label', { source: t(`preparation.labels.source.${answer.source.toLowerCase()}`) })}</span>
          <span className="badge">{t('preparation.confidence_label', { confidence: t(`preparation.labels.confidence.${answer.confidence.toLowerCase()}`) })}</span>
        </div>
        <p>{displayAnswer(answer.answer)}</p>
        {answer.reviewReason && <p role="alert">{answer.reviewReason}</p>}
        {answer.evidence?.sources.map(source => <p className="muted" key={source.kind + source.id}>{t('preparation.evidence', { kind: t(`preparation.labels.source.${source.kind.toLowerCase()}`), revision: source.revision, label: source.label, answer: displayAnswer(source.answer) })}
          {!answer.answer && answerFits(answer, source.answer) && <> <button disabled={busy} onClick={() => void review(answer, 'accepted', source.answer)}>{t('preparation.use_this_answer')}</button></>}</p>)}
        <div className="toolbar">
          {answer.answer && answer.approval !== 'accepted' && <button disabled={busy} onClick={() => void review(answer, 'accepted')}>{t('preparation.accept')}</button>}
          {answer.answer && answer.approval !== 'rejected' && <button disabled={busy} onClick={() => void review(answer, 'rejected')}>{t('preparation.reject')}</button>}
          <button disabled={busy || draft !== null} onClick={() => setDraft(draftFrom(answer))}>{t('edit', { ns: 'common' })}</button>
          <button disabled={busy} onClick={() => remove(answer)}>{t('remove', { ns: 'common' })}</button>
        </div>
      </div>)}
    </section>

    {draft && <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void saveDraft(draft) }}><fieldset disabled={busy}><legend>{draft.id ? t('preparation.edit_question') : t('preparation.new_question')}</legend>
      <label>{t('preparation.question')}<input value={draft.question} onChange={e => set({ question: e.target.value })} /></label>
      <div className="form-grid">
        <label>{t('preparation.concept_optional_otherwise_matched_by_wording')}<input list="known-concepts" value={draft.concept} onChange={e => set({ concept: e.target.value })} /></label>
        <label>{t('preparation.answer_type')}<select value={draft.type} onChange={e => set({ type: e.target.value as AnswerType, answer: null, accept: false })}>{ANSWER_TYPES.map(type => <option key={type} value={type}>{t(`preparation.labels.answer_type.${type}`)}</option>)}</select></label>
      </div>
      <datalist id="known-concepts">{PROFILE_CONCEPTS.map(concept => <option key={concept} value={concept} />)}</datalist>
      {(draft.type === 'single_select' || draft.type === 'multi_select') && <label>{t('preparation.options_one_per_line')}<textarea rows={3} value={draft.options} onChange={e => set({ options: e.target.value, answer: null, accept: false })} /></label>}
      <label><input type="checkbox" checked={draft.required} onChange={e => set({ required: e.target.checked })} />{t('preparation.required')}</label>
      {draft.id && <>
        <AnswerInput type={draft.type} options={optionsOf(draft)} value={draft.answer} onChange={answer => set({ answer })} />
        <label><input type="checkbox" checked={draft.accept} onChange={e => set({ accept: e.target.checked, remember: draft.remember && e.target.checked })} />{t('preparation.accept_this_answer')}</label>
        <label><input type="checkbox" checked={draft.remember} disabled={!draft.accept} onChange={e => set({ remember: e.target.checked })} />{t('preparation.remember_this_answer')}</label>
        {draft.remember && <fieldset><legend>{t('preparation.reusable_answer')}</legend><div className="form-grid">
          <label>{t('preparation.concept')}<input value={draft.rememberConcept} onChange={e => set({ rememberConcept: e.target.value })} /></label>
          <label>{t('preparation.category')}<select value={draft.category} onChange={e => set({ category: e.target.value })}>{KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{t(`preparation.labels.category.${c}`)}</option>)}</select></label>
        </div>
        <p>{t('preparation.reuse_only_when_all_of_these_match_this_application')}</p>
        {SCOPE_TYPES.map(scope => <label key={scope}><input type="checkbox" checked={draft.scopes.includes(scope)} onChange={e => set({ scopes: e.target.checked ? [...draft.scopes, scope] : draft.scopes.filter(s => s !== scope) })} />{t(`preparation.labels.scope.${scope.toLowerCase()}`)}</label>)}
        {draft.scopes.length === 0 && <p role="alert">{t('preparation.unrestricted_answer_hint')}</p>}
        </fieldset>}
      </>}
      <div className="toolbar"><button>{busy ? t('saving', { ns: 'common' }) : t('save', { ns: 'common' })}</button><button type="button" onClick={() => { if (confirmDiscard(true)) setDraft(null) }}>{t('cancel', { ns: 'common' })}</button></div>
    </fieldset></form>}
  </article>
}
