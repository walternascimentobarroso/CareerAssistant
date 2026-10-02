import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { ModelPicker } from '../components/ModelPicker'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type AiSettings, type LiveApplication } from '../data/loadApplications'
import { changedKeys, fieldsFromForm, formFromApplication, formFromSuggestion, validateFields, type ApplicationFormValues, type FieldErrors } from '../domain/applicationForm'
import { slugify, todayIsoDate } from '../domain/format'
import { LIST_SECTION_LABELS, linesToItems } from '../domain/jobDescription'
import type { Suggestion } from '../domain/suggestion'

const EXTRACTED_SECTIONS = ['keyRequirements', 'niceToHave', 'technologies'] as const
type Sections = Record<(typeof EXTRACTED_SECTIONS)[number], string>
const NO_SECTIONS: Sections = { keyRequirements: '', niceToHave: '', technologies: '' }

export function NewApplicationPage() {
  const [step, setStep] = useState<'posting' | 'review'>('posting')
  const [jobPosting, setJobPosting] = useState('')
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [form, setForm] = useState(formFromApplication)
  const [sections, setSections] = useState(NO_SECTIONS)
  const [suggested, setSuggested] = useState<ReadonlySet<keyof ApplicationFormValues>>(new Set())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const { reload } = useApplications()
  const navigate = useNavigate()
  useUnsavedGuard(dirty)
  useEffect(() => {
    void request<AiSettings>('/settings').then(loaded => { setSettings(loaded); setProvider(loaded.provider); setModel(loaded.model) }).catch(e => setMessage(e.message))
  }, [])
  const slug = slugify(`${form.company} ${form.role}`)
  const hasKey = settings?.providers.find(p => p.id === provider)?.configured
  async function extract() {
    if (changedKeys(formFromApplication(), form).length > 0 && !window.confirm('Replace the fields already filled in with a new AI proposal?')) return
    setBusy(true); setMessage('')
    try {
      const { suggestion, ...used } = await request<{ suggestion: Suggestion; provider: string; model: string }>('/extract', 'POST', { text: jobPosting, provider, ...(model.trim() && { model: model.trim() }) })
      const proposed = formFromSuggestion(suggestion)
      setForm(proposed); setSuggested(new Set(changedKeys(formFromApplication(), proposed)))
      setSections({ keyRequirements: suggestion.keyRequirements.join('\n'), niceToHave: suggestion.niceToHave.join('\n'), technologies: suggestion.technologies.join('\n') })
      setErrors({}); setStep('review'); setMessage(`Filled in by ${used.model}. Check every field before creating.`)
    } catch (e) { setMessage(`${(e as Error).message} You can try again, pick another model or fill in manually.`) }
    finally { setBusy(false) }
  }
  function edit(value: ApplicationFormValues) {
    const edited = changedKeys(form, value)
    setSuggested(new Set([...suggested].filter(key => !edited.includes(key))))
    setForm(value); setDirty(true)
  }
  async function create() {
    const fields = fieldsFromForm(form)
    const found = validateFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) { setMessage('Fix the highlighted fields.'); return }
    setBusy(true); setMessage('')
    try {
      const jobSections = Object.fromEntries(EXTRACTED_SECTIONS.map(section => [section, linesToItems(sections[section])]))
      const body = { fields, applied: form.applied_at !== '', date: form.applied_at || todayIsoDate(), ...(jobPosting.trim() && { jobPosting, jobSections }) }
      const created = await request<LiveApplication>('/applications', 'POST', body)
      await reload(); setDirty(false); navigate(`/applications/${created.slug}`)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  if (step === 'posting') return <article className="detail">
    <Link to="/" className="back">← Board</Link>
    <h1>New application</h1>
    <p className="muted">Step 1 of 2. Paste the posting and let AI propose the fields; you review everything on the next step. Nothing is saved yet.</p>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void extract() }}>
      <label>Job posting — paste the full text, unedited<textarea rows={16} value={jobPosting} disabled={busy} onChange={e => { setJobPosting(e.target.value); setDirty(true) }} /></label>
      {settings && <ModelPicker settings={settings} provider={provider} model={model} disabled={busy} onChange={(nextProvider, nextModel) => { setProvider(nextProvider); setModel(nextModel) }} />}
      {settings && !hasKey && <p className="muted">This provider has no API key yet. Add one in <Link to="/settings">Settings</Link>.</p>}
      <p className="muted">Only the posting text is sent to the provider; CVs and notes never are.</p>
      <div className="toolbar">
        <button disabled={busy || !jobPosting.trim() || !hasKey}>{busy ? 'Reading the posting…' : 'Extract fields'}</button>
        <button type="button" disabled={busy} onClick={() => { setStep('review'); setMessage('') }}>Fill in manually</button>
      </div>
      <p role="status">{message}</p>
    </form>
  </article>
  return <article className="detail">
    <Link to="/" className="back">← Board</Link>
    <h1>New application</h1>
    <p className="muted">Step 2 of 2. {slug ? `Will be saved in applications/${slug}/ and that name never changes.` : 'Fill in company and role.'} Leave "Applied on" empty if you have not applied yet.</p>
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void create() }}>
      <ApplicationForm value={form} errors={errors} disabled={busy} suggested={suggested} onChange={edit} />
      {jobPosting.trim() && <fieldset>
        <legend>Job description (one item per line)</legend>
        <div className="form-grid">
          {EXTRACTED_SECTIONS.map(section => <label key={section}>{LIST_SECTION_LABELS[section]}<textarea rows={8} value={sections[section]} disabled={busy} onChange={e => { setSections({ ...sections, [section]: e.target.value }); setDirty(true) }} /></label>)}
        </div>
        <p className="muted">The posting text you pasted is saved unedited alongside these lists.</p>
      </fieldset>}
      <div className="toolbar">
        <button type="button" disabled={busy} onClick={() => { setStep('posting'); setMessage('') }}>← Back to posting</button>
        <button disabled={busy}>{busy ? 'Saving…' : 'Create application'}</button>
      </div>
      <p role="status">{message}</p>
    </form>
  </article>
}
