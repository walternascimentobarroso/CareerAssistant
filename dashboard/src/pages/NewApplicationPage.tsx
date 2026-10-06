import { useTranslation } from 'react-i18next'
import { applyProfileSalary, hasSalaryData, type PersonalProfile } from '../domain/personalProfile'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { ModelPicker } from '../components/ModelPicker'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type AiSettings, type LiveApplication } from '../data/loadApplications'
import { changedKeys, fieldsFromForm, formFromApplication, formFromSuggestion, validateFields, type ApplicationFormValues, type FieldErrors } from '../domain/applicationForm'
import { slugify, todayIsoDate } from '../domain/format'
import { linesToItems } from '../domain/jobDescription'
import type { FetchedJobPosting, JobPostingCapture } from '../domain/jobPosting'
import type { Suggestion } from '../domain/suggestion'

const EXTRACTED_SECTIONS = ['keyRequirements', 'niceToHave', 'technologies'] as const
type Sections = Record<(typeof EXTRACTED_SECTIONS)[number], string>
const NO_SECTIONS: Sections = { keyRequirements: '', niceToHave: '', technologies: '' }

export function NewApplicationPage() {
  const { t } = useTranslation('pages')
  const [profile, setProfile] = useState<PersonalProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  async function loadProfile() {
    setProfileError('')
    try { setProfile((await request<{ profile: PersonalProfile | null }>('/profile')).profile) }
    catch { setProfileError(t('new_application.profile_error')) }
  }
  useEffect(() => { void loadProfile() }, [])
  const [step, setStep] = useState<'posting' | 'review'>('posting')
  const [jobPosting, setJobPosting] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  // The import the current text came from; it only changes with a new successful import or an explicit discard.
  const [imported, setImported] = useState<FetchedJobPosting | null>(null)
  const latestImport = useRef(0)
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [form, setForm] = useState(formFromApplication)
  const [sections, setSections] = useState(NO_SECTIONS)
  const [suggested, setSuggested] = useState<ReadonlySet<keyof ApplicationFormValues>>(new Set())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState<'' | 'importing' | 'extracting' | 'saving'>('')
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const { reload } = useApplications()
  const navigate = useNavigate()
  useUnsavedGuard(dirty)
  // A response arriving after the page was left must not touch its state.
  useEffect(() => () => { latestImport.current++ }, [])
  useEffect(() => {
    void request<AiSettings>('/settings').then(loaded => { setSettings(loaded); setProvider(loaded.provider); setModel(loaded.model) }).catch(e => setMessage(e.message))
  }, [])
  const slug = slugify(`${form.company} ${form.role}`)
  const hasKey = settings?.providers.find(p => p.id === provider)?.configured
  async function importFromUrl() {
    if (jobPosting.trim() && !window.confirm(t('new_application.replace_posting'))) return
    const current = ++latestImport.current
    setBusy('importing'); setMessage('')
    try {
      const fetched = await request<FetchedJobPosting>('/job-postings/fetch', 'POST', { url: jobUrl.trim() })
      if (current !== latestImport.current) return
      setJobPosting(fetched.text); setImported(fetched); setDirty(true)
      setMessage(t('new_application.import_success'))
    } catch (e) {
      if (current === latestImport.current) setMessage(t('new_application.import_error', { error: (e as Error).message }))
    } finally {
      if (current === latestImport.current) setBusy('')
    }
  }
  // The link typed by the user wins over whatever the AI reads in the text.
  const withTypedUrl = (values: ApplicationFormValues) => ({ ...values, job_url: jobUrl.trim() || values.job_url })
  async function extract() {
    if (changedKeys(formFromApplication(), form).some(key => key !== 'job_url') && !window.confirm(t('new_application.replace_fields'))) return
    setBusy('extracting'); setMessage('')
    try {
      const { suggestion, ...used } = await request<{ suggestion: Suggestion; provider: string; model: string }>('/extract', 'POST', { text: jobPosting, provider, ...(model.trim() && { model: model.trim() }) })
      const proposed = withTypedUrl(formFromSuggestion(suggestion))
      setForm(proposed); setSuggested(new Set(changedKeys(withTypedUrl(formFromApplication()), proposed)))
      setSections({ keyRequirements: suggestion.keyRequirements.join('\n'), niceToHave: suggestion.niceToHave.join('\n'), technologies: suggestion.technologies.join('\n') })
      setErrors({}); setStep('review'); setMessage(t('new_application.extracted', { model: used.model }))
    } catch (e) { setMessage(t('new_application.extract_error', { error: (e as Error).message })) }
    finally { setBusy('') }
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
    if (Object.keys(found).length > 0) { setMessage(t('fix_fields', { ns: 'common' })); return }
    setBusy('saving'); setMessage('')
    try {
      const jobSections = Object.fromEntries(EXTRACTED_SECTIONS.map(section => [section, linesToItems(sections[section])]))
      const jobPostingCapture: JobPostingCapture = imported
        ? { inputKind: 'url', sourceUrl: imported.requestedUrl, resolvedUrl: imported.resolvedUrl, capturedAt: imported.capturedAt, method: imported.method, edited: jobPosting !== imported.text }
        : { inputKind: 'manual' }
      const body = { fields, applied: form.applied_at !== '', date: form.applied_at || todayIsoDate(), ...(jobPosting.trim() && { jobPosting, jobSections, jobPostingCapture }) }
      const created = await request<LiveApplication>('/applications', 'POST', body)
      await reload(); setDirty(false); navigate(`/applications/${created.slug}`)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy('') }
  }
  if (step === 'posting') return <article className="detail">
    <Link to="/" className="back">{t('back_to_board', { ns: 'common' })}</Link>
    <h1>{t('new_application', { ns: 'common' })}</h1>
    <p className="muted">{t('new_application.step_one')}</p>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void extract() }}>
      <label>{t('new_application.job_url')}<input type="url" value={jobUrl} disabled={!!busy} placeholder="https://" onChange={e => { setJobUrl(e.target.value); setDirty(true) }}
        onKeyDown={e => { if (e.key !== 'Enter') return; e.preventDefault(); if (jobUrl.trim()) void importFromUrl() }} /></label>
      <div className="toolbar">
        <button type="button" disabled={!!busy || !jobUrl.trim()} onClick={() => void importFromUrl()}>{busy === 'importing' ? t('new_application.importing') : t('new_application.import_url')}</button>
        <span className="muted">{t('new_application.import_hint')}</span>
      </div>
      <p className="muted">{t('new_application.or')}</p>
      <label>{t('new_application.paste_description')}<textarea rows={16} value={jobPosting} disabled={!!busy} onChange={e => { setJobPosting(e.target.value); setDirty(true) }} /></label>
      {imported && <div className="toolbar">
        <span className="muted">{t('new_application.imported_from', { url: imported.resolvedUrl, edited: jobPosting !== imported.text ? t('new_application.edited_since') : '' })}</span>
        <button type="button" disabled={!!busy} onClick={() => setImported(null)}>{t('new_application.treat_as_pasted')}</button>
      </div>}
      {settings && <ModelPicker settings={settings} provider={provider} model={model} disabled={!!busy} onChange={(nextProvider, nextModel) => { setProvider(nextProvider); setModel(nextModel) }} />}
      {settings && !hasKey && <p className="muted">{t('new_application.provider_no_key')}<Link to="/settings">{t('settings', { ns: 'common' })}</Link>.</p>}
      <p className="muted">{t('new_application.privacy')}</p>
      <div className="toolbar">
        <button disabled={!!busy || !jobPosting.trim() || !hasKey}>{busy === 'extracting' ? t('new_application.extracting') : t('new_application.extract_fields')}</button>
        <button type="button" disabled={!!busy} onClick={() => { setForm(withTypedUrl(form)); setStep('review'); setMessage('') }}>{t('new_application.fill_manually')}</button>
      </div>
      <p role="status">{message}</p>
    </form>
  </article>
  return <article className="detail">
    <Link to="/" className="back">{t('back_to_board', { ns: 'common' })}</Link>
    <h1>{t('new_application', { ns: 'common' })}</h1>
    <p className="muted">{t('new_application.step_two', { identifier: slug ? t('new_application.identifier', { slug }) : t('new_application.fill_company_role') })}</p>
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void create() }}>
      {profile?.salaryExpected && profile.salaryCurrency && profile.salaryPeriod && <button type="button" disabled={!!busy} onClick={() => {
        if (hasSalaryData(form) && !window.confirm(t('new_application.replace_salary'))) return
        edit(applyProfileSalary(form, profile)); setErrors({})
      }}>{t('new_application.profile_salary')}</button>}
      {profileError && <p role="status">{profileError} <button type="button" disabled={!!busy} onClick={() => void loadProfile()}>{t('retry', { ns: 'common' })}</button></p>}
      <ApplicationForm value={form} errors={errors} disabled={!!busy} suggested={suggested} onChange={edit} />
      {jobPosting.trim() && <fieldset>
        <legend>{t('new_application.description_lists')}</legend>
        <div className="form-grid">
          {EXTRACTED_SECTIONS.map(section => <label key={section}>{t(`new_application.${({ keyRequirements: 'key_requirements', niceToHave: 'nice_to_have', technologies: 'technologies' } as const)[section]}`)}<textarea rows={8} value={sections[section]} disabled={!!busy} onChange={e => { setSections({ ...sections, [section]: e.target.value }); setDirty(true) }} /></label>)}
        </div>
        <p className="muted">{t('new_application.posting_saved_hint')}</p>
      </fieldset>}
      <div className="toolbar">
        <button type="button" disabled={!!busy} onClick={() => { setStep('posting'); setMessage('') }}>{t('new_application.back_to_posting')}</button>
        <button disabled={!!busy}>{busy === 'saving' ? t('saving', { ns: 'common' }) : t('new_application.create')}</button>
      </div>
      <p role="status">{message}</p>
    </form>
  </article>
}
