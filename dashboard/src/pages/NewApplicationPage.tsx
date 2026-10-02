import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { fieldsFromForm, formFromApplication, validateFields, type FieldErrors } from '../domain/applicationForm'
import { slugify, todayIsoDate } from '../domain/format'

export function NewApplicationPage() {
  const [form, setForm] = useState(formFromApplication)
  const [jobPosting, setJobPosting] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)
  const { reload } = useApplications()
  const navigate = useNavigate()
  useUnsavedGuard(dirty)
  const slug = slugify(`${form.company} ${form.role}`)
  async function create() {
    const fields = fieldsFromForm(form)
    const found = validateFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) { setMessage('Fix the highlighted fields.'); return }
    setBusy(true); setMessage('')
    try {
      const body = { fields, applied: form.applied_at !== '', date: form.applied_at || todayIsoDate(), ...(jobPosting.trim() && { jobPosting }) }
      const created = await request<LiveApplication>('/applications', 'POST', body)
      await reload(); setDirty(false); navigate(`/applications/${created.slug}`)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <article className="detail">
    <Link to="/" className="back">← Board</Link>
    <h1>New application</h1>
    <p className="muted">{slug ? `Will be saved in applications/${slug}/ and that name never changes.` : 'Fill in company and role to start.'} Leave "Applied on" empty if you have not applied yet.</p>
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void create() }}>
      <ApplicationForm value={form} errors={errors} disabled={busy} onChange={value => { setForm(value); setDirty(true) }} />
      <fieldset>
        <legend>Job posting</legend>
        <label>Paste the full posting text, unedited. Postings disappear; this copy is the record.<textarea rows={12} value={jobPosting} disabled={busy} onChange={e => { setJobPosting(e.target.value); setDirty(true) }} /></label>
      </fieldset>
      <div className="toolbar"><button disabled={busy}>{busy ? 'Saving…' : 'Create application'}</button>{dirty && <span>Unsaved changes</span>}</div>
      <p role="status">{message}</p>
    </form>
  </article>
}
