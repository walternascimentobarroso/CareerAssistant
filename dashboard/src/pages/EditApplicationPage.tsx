import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { fieldsFromForm, formFromApplication, validateFields, type FieldErrors } from '../domain/applicationForm'

export function EditApplicationPage() {
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">Application not found.</p>
  return <EditApplication key={application.slug} application={application} />
}

function EditApplication({ application }: { application: LiveApplication }) {
  // The copy opened for editing: a file changed elsewhere meanwhile must be rejected, not overwritten.
  const [opened] = useState(application)
  const [form, setForm] = useState(() => formFromApplication(opened.data))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const { reload } = useApplications()
  const navigate = useNavigate()
  useUnsavedGuard(dirty)
  const page = `/applications/${opened.slug}`
  async function save() {
    const fields = fieldsFromForm(form, opened.data)
    const found = validateFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) { setMessage('Fix the highlighted fields.'); return }
    setBusy(true); setMessage('')
    try {
      await request(page, 'PATCH', { revision: opened.revision, fields })
      await reload(); setDirty(false); navigate(page)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <article className="detail">
    <Link to={page} className="back">← {opened.data.company} — {opened.data.role}</Link>
    <h1>Edit application</h1>
    <p className="muted">Status changes from the board, timeline events and notes from the application page.</p>
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <ApplicationForm value={form} errors={errors} disabled={busy} onChange={value => { setForm(value); setDirty(true) }} />
      <div className="toolbar"><button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>{dirty && <span>Unsaved changes</span>}</div>
      <p role="status">{message}</p>
    </form>
  </article>
}
