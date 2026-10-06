import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
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
  const [applyUrl, setApplyUrl] = useState(application.data.apply_url ?? '')
  const [applyUrlMessage, setApplyUrlMessage] = useState('')
  const applyUrlDirty = applyUrl.trim() !== (application.data.apply_url ?? '')
  useUnsavedGuard(dirty || applyUrlDirty)
  const page = `/applications/${application.slug}`
  async function saveApplyUrl() {
    setBusy(true); setApplyUrlMessage('')
    try {
      await request(page, 'PATCH', { revision: application.revision, fields: { apply_url: applyUrl.trim() || null } })
      await reload(); setApplyUrlMessage(t('job_description.apply_link_saved'))
    } catch (e) { setApplyUrlMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  const set = (changes: Partial<JobDescription>) => { setDescription({ ...description, ...changes }); setDirty(true) }
  async function save() {
    setBusy(true); setMessage('')
    try {
      const items = Object.fromEntries(listSections().map(section => [section, linesToItems(lists[section])]))
      const content = serializeJobDescription({ ...description, ...items })
      await request(`${page}/job-description`, 'PUT', { content, revision: opened === undefined ? null : application.jobRevision })
      await reload(); setDirty(false); navigate(`${page}/doc/${JOB_DESCRIPTION_FILE}`)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <article className="detail">
    <Link to={page} className="back">← {application.data.company} — {application.data.role}</Link>
    <h1>{t('job_description.job_description')}</h1>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void saveApplyUrl() }}>
      <div className="inline-form">
        <label>{t('job_description.apply_link')}<input type="url" placeholder="https://..." value={applyUrl} disabled={busy} onChange={e => setApplyUrl(e.target.value)} /></label>
        <button disabled={busy || !applyUrlDirty}>{t('job_description.save_apply_link')}</button>
      </div>
      <p role="status">{applyUrlMessage}</p>
    </form>
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
      <div className="toolbar"><button disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('job_description.save_job_description')}</button>{dirty && <span>{t('unsaved_changes', { ns: 'common' })}</span>}</div>
      <p role="status">{message}</p>
    </form>
  </article>
}
