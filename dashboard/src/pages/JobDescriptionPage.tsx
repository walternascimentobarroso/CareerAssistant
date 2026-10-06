import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { StepIndicator } from '../components/StepIndicator'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, usePreparation, type LiveApplication } from '../data/loadApplications'
import { applicationFlowSteps, isInFlow } from '../domain/applicationFlow'
import { todayIsoDate } from '../domain/format'
import { JOB_DESCRIPTION_FILE, emptyJobDescription, linesToItems, listSections, parseJobDescription, serializeJobDescription, type JobDescription } from '../domain/jobDescription'

export function JobDescriptionPage() {
  const { t } = useTranslation('pages')
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">{t('application_not_found', { ns: 'common' })}</p>
  return <JobDescriptionEditor key={application.slug} application={application} />
}

function initialDescription(application: LiveApplication, saved: string | undefined): JobDescription {
  if (saved !== undefined) return parseJobDescription(saved)
  return { ...emptyJobDescription(), source: application.data.job_url ?? '', capturedOn: todayIsoDate() }
}

function JobDescriptionEditor({ application }: { application: LiveApplication }) {
  const { t } = useTranslation('pages')
  // The content opened for editing: a file changed elsewhere meanwhile must be rejected, not overwritten.
  const [opened] = useState(application.documents[JOB_DESCRIPTION_FILE])
  const [description, setDescription] = useState(() => initialDescription(application, opened))
  const [lists, setLists] = useState(() => Object.fromEntries(listSections().map(section => [section, description[section].join('\n')])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const { reload } = useApplications()
  const navigate = useNavigate()
  const preparation = usePreparation(application.slug)
  useUnsavedGuard(dirty)
  const page = `/applications/${application.slug}`
  const inFlow = isInFlow(application)
  const set = (changes: Partial<JobDescription>) => { setDescription({ ...description, ...changes }); setDirty(true) }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const items = Object.fromEntries(listSections().map(section => [section, linesToItems(lists[section])]))
      const content = serializeJobDescription({ ...description, ...items })
      await request(`${page}/job-description`, 'PUT', { content, revision: opened === undefined ? null : application.jobRevision })
      await reload(); setDirty(false); navigate(inFlow ? `${page}/edit` : `${page}/doc/${JOB_DESCRIPTION_FILE}`)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <article className="detail">
    {inFlow && <StepIndicator steps={applicationFlowSteps(application, preparation, 'posting', t).steps} />}
    <Link to={page} className="back">← {application.data.company} — {application.data.role}</Link>
    <h1>{t('job_description.job_description')}</h1>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="form-grid">
        <label>{t('job_description.source_link_to_the_posting')}<input type="url" value={description.source} disabled={busy} onChange={e => set({ source: e.target.value })} /></label>
        <label>{t('job_description.captured_on')}<input type="date" value={description.capturedOn} disabled={busy} onChange={e => set({ capturedOn: e.target.value })} /></label>
      </div>
      {description.provenance && <p className="muted">{description.provenance.inputKind === 'manual' ? t('job_description.provenance_manual', { date: new Date(description.provenance.capturedAt).toLocaleString() }) : t('job_description.provenance_imported', { url: description.provenance.resolvedUrl, date: new Date(description.provenance.capturedAt).toLocaleString(), edited: description.provenance.edited ? t('job_description.provenance_edited') : '' })}{' '}{t('job_description.provenance_hint')}</p>}
      <label>{t('job_description.original_text_paste_the_full_posting_unedited')}<textarea rows={16} required value={description.originalText} disabled={busy} onChange={e => set({ originalText: e.target.value })} /></label>
      <div className="form-grid">
        {listSections().map(section => <label key={section}>{t('job_description.list_label', { label: t(`job_description.sections.${({ keyRequirements: 'key_requirements', niceToHave: 'nice_to_have', technologies: 'technologies', openQuestions: 'open_questions' } as const)[section]}`) })}<textarea rows={6} value={lists[section]} disabled={busy} onChange={e => { setLists({ ...lists, [section]: e.target.value }); setDirty(true) }} /></label>)}
      </div>
      {(opened !== undefined && parseJobDescription(opened).other !== '') && <label>{t('job_description.other_content_found_in_the_file_kept_as_written')}<textarea rows={6} value={description.other} disabled={busy} onChange={e => set({ other: e.target.value })} /></label>}
      {!inFlow && <div className="toolbar"><button disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('job_description.save_job_description')}</button>{dirty && <span>{t('unsaved_changes', { ns: 'common' })}</span>}</div>}
      {inFlow && <div className="flow-actions">
        <Link to={page} className="button">{t('flow.back_to_overview')}</Link>
        <span className="toolbar">{dirty && <span>{t('unsaved_changes', { ns: 'common' })}</span>}
          {dirty ? <button className="primary" disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('flow.save_and_continue')}</button> : <Link to={`${page}/edit`} className="button primary">{t('flow.continue')}</Link>}</span>
      </div>}
      <p role="status">{message}</p>
    </form>
  </article>
}
