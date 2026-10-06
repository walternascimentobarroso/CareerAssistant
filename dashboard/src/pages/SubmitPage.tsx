import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { StepIndicator } from '../components/StepIndicator'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { applicationFlowSteps, isInFlow, validApplyUrl } from '../domain/applicationFlow'
import { preparationSummary, type Preparation } from '../domain/applicationPreparation'
import { formatDate, todayIsoDate } from '../domain/format'

type FormInspection = { sessionId: string; fields: { selector: string; label: string; filled: boolean }[]; screenshot: string; canAutoFill: boolean }

export function SubmitPage() {
  const { t } = useTranslation('pages')
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">{t('application_not_found', { ns: 'common' })}</p>
  return <SubmitWorkspace application={application} key={application.slug} />
}

function SubmitWorkspace({ application }: { application: LiveApplication }) {
  const { t } = useTranslation('pages')
  const { reload } = useApplications()
  const [preparation, setPreparation] = useState<Preparation | null>(null)
  const [busy, setBusy] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [inspection, setInspection] = useState<FormInspection | null>(null)
  const [message, setMessage] = useState('')
  const [sentOn, setSentOn] = useState(todayIsoDate)
  const [recording, setRecording] = useState(false)
  const page = `/applications/${application.slug}`
  const formPath = `${page}/preparation`

  async function load() {
    try { setPreparation((await request<{ preparation: Preparation }>(`${page}/preparations`, 'POST', {})).preparation) }
    catch (e) { setMessage((e as Error).message) }
  }
  useEffect(() => { void load() }, [])

  async function inspectForm() {
    setBusy(true); setInspecting(true); setMessage('')
    try {
      const inspected = await request<FormInspection>(`${formPath}/inspect-form`, 'POST', {})
      await load()
      setInspection(inspected)
    } catch (e) { setMessage((e as Error).message) }
    finally { setInspecting(false); setBusy(false) }
  }
  async function submitForm(sessionId: string) {
    setBusy(true); setMessage('')
    try { await request(`${formPath}/submit-form`, 'POST', { sessionId }) }
    catch (e) { setMessage((e as Error).message); return }
    finally { setBusy(false) }
    setInspection(null)
    await reload().catch(() => {})
  }
  async function cancelForm(sessionId: string) {
    setInspection(null); setMessage('')
    try { await request(`${formPath}/cancel-form`, 'POST', { sessionId }) }
    // A session that already expired has nothing left to cancel.
    catch (e) { if ((e as { status?: number }).status !== 404) setMessage((e as Error).message) }
  }

  const { steps } = applicationFlowSteps(application, preparation ?? undefined, 'submit', t)
  const applyUrl = validApplyUrl(application.data.apply_url)
  const summary = preparation && preparationSummary(preparation)
  const cvReady = !!preparation && (!!preparation.cv || !preparation.cvRequired)
  const answersReady = !!summary && summary.total > 0 && summary.accepted === summary.total
  const canApplyAutomatically = !!applyUrl && !!preparation?.answers.some(answer => answer.approval === 'accepted')
  async function recordSubmission() {
    if (!window.confirm(t('submit.record_confirm', { company: application.data.company, date: formatDate(sentOn) }))) return
    setBusy(true); setRecording(true); setMessage('')
    try {
      await request(`${page}/record-submission`, 'POST', { date: sentOn, revision: application.revision, ...(applyUrl && { channel: applyUrl }), ...(preparation?.cv && { cvVersionId: preparation.cv.versionId }) })
      await reload()
    } catch (e) { setMessage((e as Error).message) }
    finally { setRecording(false); setBusy(false) }
  }
  const fixInPreparation = <> — <Link to={`${page}/preparation`}>{t('submit.fix_in_preparation')}</Link></>

  return <article className="detail">
    <StepIndicator steps={steps} />
    <Link to={page} className="back">← {application.data.company}</Link>
    <header><h1>{t('submit.title')}</h1><p className="detail-role">{application.data.company} · {application.data.role}</p></header>
    {!inspection && <p role="status">{message}</p>}

    {!isInFlow(application) && <section className="detail-section">
      <p>✓ {t('submit.done', { date: application.data.applied_at ? formatDate(application.data.applied_at) : '—' })}</p>
      <p><Link to={page} className="button primary">{t('submit.view_application')}</Link></p>
    </section>}

    {isInFlow(application) && <>
      <section className="detail-section"><h2>{t('submit.before')}</h2>
        <ul className="checklist">
          <li data-done={!!applyUrl}>{applyUrl ? t('submit.check_link', { host: new URL(applyUrl).host }) : <>{t('submit.check_link_missing')} — <Link to={`${page}/edit`}>{t('submit.fix_in_details')}</Link></>}</li>
          <li data-done={cvReady}>{preparation?.cv ? t('submit.check_cv', { version: `${preparation.cv.name} v${preparation.cv.version}` }) : cvReady ? t('preparation.check_cv_not_required') : <>{t('submit.check_cv_none')}{fixInPreparation}</>}</li>
          <li data-done={answersReady}>{answersReady ? t('submit.check_answers_done', { total: summary.total }) : <>{t('submit.check_answers_progress', { accepted: summary?.accepted ?? 0, total: summary?.total ?? 0 })}{fixInPreparation}</>}</li>
          <li data-done={!!preparation?.formInspected}>{preparation?.formInspected ? t('submit.check_form') : t('submit.check_form_pending')}</li>
        </ul>
      </section>

      <fieldset><legend>{t('submit.auto_title')}</legend>
        <p>{t('submit.auto_text')}</p>
        <p><button className="primary" disabled={busy || !canApplyAutomatically} onClick={() => void inspectForm()}>{inspecting ? t('preparation.inspecting') : t('submit.auto_action')}</button></p>
        {!canApplyAutomatically && <p className="muted">{t('preparation.auto_apply_requirements')}</p>}
      </fieldset>

      <fieldset><legend>{t('submit.manual_title')}</legend>
        <p>{t('submit.manual_text')}</p>
        {applyUrl ? <p><a className="button" href={applyUrl} target="_blank" rel="noreferrer">{t('submit.manual_open')}</a></p> : <p className="muted">{t('submit.manual_no_link')}</p>}
        <div className="inline-form">
          <label>{t('submit.sent_on')}<input type="date" value={sentOn} disabled={busy} onChange={e => setSentOn(e.target.value)} /></label>
          <button disabled={busy || !sentOn} onClick={() => void recordSubmission()}>{recording ? t('submit.recording') : t('submit.record')}</button>
        </div>
      </fieldset>
    </>}

    <div className="flow-actions"><Link to={`${page}/preparation`} className="button">{t('flow.back_to_preparation')}</Link></div>
    {inspection && <FormInspectionDialog inspection={inspection} busy={busy} error={message} onConfirm={() => void submitForm(inspection.sessionId)} onCancel={() => void cancelForm(inspection.sessionId)} />}
  </article>
}

function FormInspectionDialog({ inspection, busy, error, onConfirm, onCancel }: { inspection: FormInspection; busy: boolean; error: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation('pages')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="message-dialog" style={{ overflow: 'auto' }} onCancel={e => { if (busy) e.preventDefault() }} onClose={onCancel}>
    <h2>{t('preparation.form_inspection')}</h2>
    <img src={`data:image/png;base64,${inspection.screenshot}`} alt={t('preparation.form_screenshot')} style={{ maxWidth: '100%' }} />
    <h3>{t('preparation.detected_fields')}</h3>
    {inspection.fields.length === 0 && <p className="muted">{t('preparation.no_fields_detected')}</p>}
    <ul>{inspection.fields.map(field => <li key={field.selector}>{field.label || t('preparation.unlabelled_field')} — {field.filled ? t('preparation.field_filled') : t('preparation.field_not_filled')}</li>)}</ul>
    {!inspection.canAutoFill && <p role="alert">{t('preparation.cannot_auto_fill')}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="toolbar">
      <button className="primary" disabled={busy || !inspection.canAutoFill} onClick={onConfirm}>{busy ? t('preparation.submitting') : t('preparation.confirm_and_submit')}</button>
      <button type="button" disabled={busy} onClick={onCancel}>{t('cancel', { ns: 'common' })}</button>
    </div>
  </dialog>
}
