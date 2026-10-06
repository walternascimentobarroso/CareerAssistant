import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useState } from 'react'
import { AnswerInput } from '../components/AnswerInput'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS } from '../domain/constants'
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
function scopeLabel(context: Restriction[], applications: LiveApplication[], t: TFunction) {
  if (!context.length) return t('knowledge.global')
  const linked = (item: Restriction) => {
    if (item.type === 'APPLICATION') return applications.find(a => a.id === item.value)?.slug
    if (item.type === 'JOB') return applications.find(a => a.jobId === item.value)?.data.role
    if (item.type === 'COMPANY') return applications.find(a => a.companyId === item.value)?.data.company
    return item.type === 'CONTRACT_TYPE' ? t(`contract_type.${item.value}`, { ns: 'status' }) : item.value
  }
  return context.map(item => `${t(`knowledge.labels.scope.${item.type.toLowerCase()}`)}: ${linked(item) ?? t('knowledge.removed_record')}`).join(' · ')
}

export function KnowledgePage() {
  const { t } = useTranslation('pages')
  const displayAnswer = (answer: AnswerValue | null) => {
    if (answer?.type === 'boolean') return t(answer.value ? 'yes' : 'no', { ns: 'common' })
    if (answer?.type === 'money') return `${answer.amount} ${answer.currency}/${t(`rate_period.${answer.period}`, { ns: 'common' })}`
    return formatAnswer(answer)
  }
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
      setDraft(null); setMessage(t('knowledge.answer_saved')); await load()
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function remove(entry: KnowledgeEntry) {
    if (!window.confirm(t('knowledge.confirm_remove', { concept: entry.concept }))) return
    setMessage('')
    try { await request(`/knowledge/${entry.id}`, 'DELETE', { revision: entry.revision }); setMessage(t('knowledge.answer_removed')) }
    catch (e) { setMessage((e as Error).message) }
    await load()
  }

  const wanted = search.trim().toLowerCase()
  const visible = entries.filter(entry => (!category || entry.category === category)
    && [entry.concept, entry.question, displayAnswer(entry.answer), ...entry.aliases].some(text => text.toLowerCase().includes(wanted)))
  return <article className="detail">
    <h1>{t('knowledge.knowledge_base')}</h1>
    <p className="muted">{t('knowledge.reuse_hint')}</p>
    <div className="toolbar">
      <input type="search" placeholder={t('knowledge.search')} aria-label={t('knowledge.search_answers')} value={search} onChange={e => setSearch(e.target.value)} />
      <select aria-label={t('knowledge.category')} value={category} onChange={e => setCategory(e.target.value)}><option value="">{t('knowledge.all_categories')}</option>{KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{t(`knowledge.labels.category.${c}`)}</option>)}</select>
      <button disabled={busy} onClick={() => { if (confirmDiscard(draft !== null)) { setDraft(emptyDraft); setMessage('') } }}>{t('knowledge.new_answer')}</button>
    </div>
    <p role="status">{message}</p>
    {draft && <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void save(draft) }}>
      <fieldset disabled={busy}><legend>{draft.id ? t('knowledge.edit_answer') : t('knowledge.new_answer')}</legend><div className="form-grid">
        <label>{t('knowledge.concept_e_g_experience_symfony')}<input value={draft.concept} onChange={e => set({ concept: e.target.value })} /></label>
        <label>{t('knowledge.category')}<select value={draft.category} onChange={e => set({ category: e.target.value })}>{KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{t(`knowledge.labels.category.${c}`)}</option>)}</select></label>
        <label>{t('knowledge.language_code_e_g_en')}<input value={draft.language} onChange={e => set({ language: e.target.value })} /></label>
        <label>{t('knowledge.answer_type')}<select value={draft.type} onChange={e => set({ type: e.target.value as AnswerType, answer: null })}>{ANSWER_TYPES.map(type => <option key={type} value={type}>{t(`knowledge.labels.answer_type.${type}`)}</option>)}</select></label>
      </div>
      <label>{t('knowledge.reference_question')}<input value={draft.question} onChange={e => set({ question: e.target.value })} /></label>
      <AnswerInput type={draft.type} options={[]} value={draft.answer} onChange={answer => set({ answer })} />
      <label>{t('knowledge.equivalent_questions_hint')}<textarea rows={3} value={draft.aliases} onChange={e => set({ aliases: e.target.value })} /></label>
      <fieldset><legend>{t('knowledge.restrictions_empty_means_global')}</legend><div className="form-grid">
        <label>{t('knowledge.country_code')}<input value={draft.country} onChange={e => set({ country: e.target.value })} /></label>
        <label>{t('knowledge.location')}<input value={draft.location} onChange={e => set({ location: e.target.value })} /></label>
        <label>{t('knowledge.contract_type')}<select value={draft.contractType} onChange={e => set({ contractType: e.target.value })}><option value="">{t('knowledge.any')}</option>{CONTRACT_TYPES.map(type => <option key={type} value={type}>{t(CONTRACT_TYPE_LABELS[type], { ns: 'status' })}</option>)}</select></label>
      </div>{draft.linked.length > 0 && <p className="muted">{t('knowledge.limited_to', { scope: scopeLabel(draft.linked, applications, t) })}</p>}</fieldset>
      <label><input type="checkbox" checked={draft.confirmed} onChange={e => set({ confirmed: e.target.checked })} />{t('knowledge.confirm_answer')}</label>
      <div className="toolbar"><button disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('knowledge.save_answer')}</button><button type="button" onClick={() => { if (confirmDiscard(true)) setDraft(null) }}>{t('cancel', { ns: 'common' })}</button></div>
      </fieldset>
    </form>}
    {visible.length === 0 && <p className="muted">{t('knowledge.no_answers_found')}</p>}
    {visible.map(entry => <section className="detail-section" key={entry.id}>
      <h2>{entry.concept} · {t(`knowledge.labels.category.${entry.category}`)} · {entry.language}</h2>
      <p>{entry.question}</p>
      <p><strong>{displayAnswer(entry.answer)}</strong></p>
      <p className="muted">{scopeLabel(entry.context, applications, t)}{t('knowledge.origin', { origin: t(`knowledge.labels.source.${entry.origin.toLowerCase()}`) })}{entry.confirmedAt ? t('knowledge.reviewed', { date: new Date(entry.confirmedAt).toLocaleDateString() }) : t('knowledge.not_confirmed')}
        {entry.aliases.length > 0 && t('knowledge.equivalent_questions', { count: entry.aliases.length })}</p>
      <div className="toolbar"><button disabled={busy} onClick={() => { if (confirmDiscard(draft !== null)) { setDraft(draftFrom(entry)); setMessage('') } }}>{t('edit', { ns: 'common' })}</button>
        <button disabled={busy} onClick={() => void remove(entry)}>{t('remove', { ns: 'common' })}</button></div>
    </section>)}
  </article>
}
