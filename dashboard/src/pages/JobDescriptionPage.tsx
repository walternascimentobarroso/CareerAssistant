import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { todayIsoDate } from '../domain/format'
import { JOB_DESCRIPTION_FILE, LIST_SECTION_LABELS, emptyJobDescription, linesToItems, listSections, parseJobDescription, serializeJobDescription, type JobDescription } from '../domain/jobDescription'

export function JobDescriptionPage() {
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">Application not found.</p>
  return <JobDescriptionEditor key={application.slug} application={application} />
}

function initialDescription(application: LiveApplication, saved: string | undefined): JobDescription {
  if (saved !== undefined) return parseJobDescription(saved)
  return { ...emptyJobDescription(), source: application.data.job_url ?? '', capturedOn: todayIsoDate() }
}

function JobDescriptionEditor({ application }: { application: LiveApplication }) {
  // The content opened for editing: a file changed elsewhere meanwhile must be rejected, not overwritten.
  const [opened] = useState(application.documents[JOB_DESCRIPTION_FILE])
  const [description, setDescription] = useState(() => initialDescription(application, opened))
  const [lists, setLists] = useState(() => Object.fromEntries(listSections().map(section => [section, description[section].join('\n')])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const { reload } = useApplications()
  const navigate = useNavigate()
  useUnsavedGuard(dirty)
  const page = `/applications/${application.slug}`
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
    <h1>Job description</h1>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="form-grid">
        <label>Source (link to the posting)<input type="url" value={description.source} disabled={busy} onChange={e => set({ source: e.target.value })} /></label>
        <label>Captured on<input type="date" value={description.capturedOn} disabled={busy} onChange={e => set({ capturedOn: e.target.value })} /></label>
      </div>
      <label>Original text — paste the full posting, unedited<textarea rows={16} required value={description.originalText} disabled={busy} onChange={e => set({ originalText: e.target.value })} /></label>
      <div className="form-grid">
        {listSections().map(section => <label key={section}>{LIST_SECTION_LABELS[section]} (one per line)<textarea rows={6} value={lists[section]} disabled={busy} onChange={e => { setLists({ ...lists, [section]: e.target.value }); setDirty(true) }} /></label>)}
      </div>
      {(opened !== undefined && parseJobDescription(opened).other !== '') && <label>Other content found in the file (kept as written)<textarea rows={6} value={description.other} disabled={busy} onChange={e => set({ other: e.target.value })} /></label>}
      <div className="toolbar"><button disabled={busy}>{busy ? 'Saving…' : 'Save job description'}</button>{dirty && <span>Unsaved changes</span>}</div>
      <p role="status">{message}</p>
    </form>
  </article>
}
