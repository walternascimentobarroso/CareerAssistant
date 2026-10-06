import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApplicationForm } from '../components/ApplicationForm'
import { StepIndicator } from '../components/StepIndicator'
import { useUnsavedGuard } from '../components/useUnsavedGuard'
import { request, useApplications, usePreparation, type LiveApplication } from '../data/loadApplications'
import { applicationFlowSteps, isInFlow } from '../domain/applicationFlow'
import { fieldsFromForm, formFromApplication, validateFields, type FieldErrors } from '../domain/applicationForm'

export function EditApplicationPage() {
  const { t } = useTranslation('pages')
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">{t('application_not_found', { ns: 'common' })}</p>
  return <EditApplication key={application.slug} application={application} />
}

function EditApplication({ application }: { application: LiveApplication }) {
  const { t } = useTranslation('pages')
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
  const preparation = usePreparation(opened.slug)
  const inFlow = isInFlow(opened)
  async function save() {
    const fields = fieldsFromForm(form, opened.data)
    const found = validateFields(fields)
    setErrors(found)
    if (Object.keys(found).length > 0) { setMessage(t('fix_fields', { ns: 'common' })); return }
    setBusy(true); setMessage('')
    try {
      await request(page, 'PATCH', { revision: opened.revision, fields })
      await reload(); setDirty(false); navigate(inFlow ? `${page}/preparation` : page)
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <article className="detail">
    {inFlow && <StepIndicator steps={applicationFlowSteps(opened, preparation, 'details', t).steps} />}
    <Link to={page} className="back">← {opened.data.company} — {opened.data.role}</Link>
    <h1>{t('edit_application.title')}</h1>
    <p className="muted">{t('edit_application.help')}</p>
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <ApplicationForm value={form} errors={errors} disabled={busy} onChange={value => { setForm(value); setDirty(true) }} />
      {!inFlow && <div className="toolbar"><button disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('save_changes', { ns: 'common' })}</button>{dirty && <span>{t('unsaved_changes', { ns: 'common' })}</span>}</div>}
      {inFlow && <div className="flow-actions">
        <Link to={`${page}/job-description`} className="button">{t('flow.back_to_posting')}</Link>
        <span className="toolbar">{dirty && <span>{t('unsaved_changes', { ns: 'common' })}</span>}
          {dirty ? <button className="primary" disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('flow.save_and_continue')}</button> : <Link to={`${page}/preparation`} className="button primary">{t('flow.continue')}</Link>}</span>
      </div>}
      <p role="status">{message}</p>
    </form>
  </article>
}
