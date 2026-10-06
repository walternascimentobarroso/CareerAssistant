import { useTranslation } from 'react-i18next'
import { ApplicationHistory } from '../components/ApplicationHistory'
import { InterviewForm } from '../components/InterviewForm'
import { AddNote } from '../components/AddNote'
import { AddTimelineEvent } from '../components/AddTimelineEvent'
import { AttachCv } from '../components/AttachCv'
import { DeleteApplication } from '../components/DeleteApplication'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import { Link, useParams } from 'react-router'
import { Badges } from '../components/Badges'
import { NextActionBox } from '../components/NextActionBox'
import { StepIndicator } from '../components/StepIndicator'
import { useApplications, usePreparation, type LiveApplication } from '../data/loadApplications'
import { applicationFlowSteps, isInFlow } from '../domain/applicationFlow'
import type { Application } from '../domain/applications'
import { JOB_DESCRIPTION_FILE } from '../domain/jobDescription'
import { STATUS_LABELS } from '../domain/constants'
import { formatDate, formatRate, humanize } from '../domain/format'

const TOP_LEVEL_DOCUMENTS = [
  { path: JOB_DESCRIPTION_FILE, label: 'application.job_description' },
  { path: 'cv.md', label: 'application.cv_document' },
]

export function ApplicationPage() {
  const { t } = useTranslation('pages')
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">{t('application_not_found', { ns: 'common' })}</p>
  return <ApplicationOverview key={application.slug} application={application} />
}

function ApplicationOverview({ application }: { application: LiveApplication }) {
  const { t } = useTranslation('pages')
  const preparation = usePreparation(application.slug)
  const { data, notes } = application
  const inFlow = isInFlow(application)
  const { steps, nextStep } = applicationFlowSteps(application, preparation, null, t)
  const next = steps.find(step => step.id === nextStep)
  const timeline = [...data.timeline].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <article className="detail">
      {inFlow && <StepIndicator steps={steps} />}
      <Link to="/" className="back">
        {t('back_to_board', { ns: 'common' })}
      </Link>
      <header>
        <h1>{data.company}</h1>
        <p className="detail-role">{data.role}</p>
        <div className="detail-meta">
          <span className="badge status">{t(STATUS_LABELS[data.status], { ns: 'status' })}</span>
          <Badges data={data} />
          {data.location && <span className="muted">{data.location}</span>}
          {data.applied_at && <span className="muted">{t('application.applied', { date: formatDate(data.applied_at) })}</span>}
          {data.job_url && (
            <a href={data.job_url} target="_blank" rel="noreferrer">
              {t('application.job_posting')}
            </a>
          )}
          <Link to={`/applications/${application.slug}/edit`}>{t('application.edit')}</Link>
          {!inFlow && <Link to={`/applications/${application.slug}/preparation`}>{t('application.view_preparation')}</Link>}
        </div>
      </header>

      {inFlow && next?.to && (
        <Section title={t('flow.next.title')}>
          <div className="next-action">
            <p><strong>{t(`flow.next.${next.id}.title`)}</strong></p>
            <p className="next-action-description">{t(`flow.next.${next.id}.text`)}</p>
            <p><Link to={next.to} className="button primary">{t(`flow.next.${next.id}.action`)}</Link></p>
          </div>
        </Section>
      )}

      {data.next_action && (
        <Section title={t('application.next_action')}>
          <NextActionBox action={data.next_action} />
        </Section>
      )}

      <div className="detail-grid">
        {data.rate && (
          <Section title={t('application.rate')}>
            <p className="muted">{t('application.basis', { basis: t('application.rate_basis.' + (data.rate.basis ?? 'unknown')) })}</p>
            {data.rate.requested !== undefined && <p>{t('application.requested', { amount: formatRate(data.rate.requested, data.rate) })}</p>}
            {data.rate.minimum !== undefined && <p>{t('application.minimum', { amount: formatRate(data.rate.minimum, data.rate) })}</p>}
          </Section>
        )}

        {data.contact && (
          <Section title={t('application.contact')}>
            <p>{data.contact.name}</p>
            {data.contact.role && <p className="muted">{data.contact.role}</p>}
            {data.contact.email && <p>{data.contact.email}</p>}
            {data.contact.phone && <p>{data.contact.phone}</p>}
            {data.contact.linkedin && <p>{data.contact.linkedin}</p>}
          </Section>
        )}

        <Section title={t('application.documents')}>
          <DocumentLinks application={application} />
          {!(JOB_DESCRIPTION_FILE in application.documents) && (
            <Link to={`/applications/${application.slug}/job-description`}>{t('application.add_job_description')}</Link>
          )}
          <AttachCv application={application} />
        </Section>

        <Section title={t('application.interviews')}>
          <InterviewLinks application={application} />
          <InterviewForm application={application} />
        </Section>
      </div>

      <ApplicationHistory application={application} />

      <Section title={t('application.timeline')}>
        {timeline.length === 0 && <p className="muted">{t('application.no_events')}</p>}
        <ol className="timeline">
          {timeline.map((entry) => (
            <li key={application.eventIds?.[data.timeline.indexOf(entry)] ?? `${data.timeline.indexOf(entry)}`}>
              <span className="timeline-date">{formatDate(entry.date)}</span>
              <span className="badge">{humanize(entry.type)}</span>
              <span>{entry.description}</span>
            </li>
          ))}
        </ol>
        <AddTimelineEvent application={application} />
      </Section>

      {data.tags.length > 0 && (
        <Section title={t('application.tags')}>
          <div className="badges">
            {data.tags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title={t('application.notes')}>
        {notes && (
          <div className="markdown">
            <Markdown>{notes}</Markdown>
          </div>
        )}
        <AddNote application={application} />
      </Section>

      <Section title={t('application.remove')}>
          <DeleteApplication application={application} />
      </Section>
    </article>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function DocumentLinks({ application }: { application: Application }) {
  const { t } = useTranslation('pages')
  const available = TOP_LEVEL_DOCUMENTS.filter(({ path }) => path in application.documents)
  if (available.length === 0) return <p className="muted">{t('application.no_documents')}</p>

  return (
    <ul className="links">
      {available.map(({ path, label }) => (
        <li key={path}>
          <Link to={`/applications/${application.slug}/doc/${path}`}>{t(label)}</Link>
        </li>
      ))}
    </ul>
  )
}

function InterviewLinks({ application }: { application: Application }) {
  const { t } = useTranslation('pages')
  if (application.interviews.length === 0) return <p className="muted">{t('application.no_interviews')}</p>

  return (
    <ul className="links">
      {application.interviews.map((interview) => (
        <li key={interview.slug}>
          {interview.title}{interview.status ? ` · ${interview.status}` : ''}{interview.date ? ` · ${interview.date}` : ''}
          {interview.participants?.map((participant,index)=><p key={index} className="muted">{participant.name}{participant.role ? ` (${participant.role})` : ''}</p>)}
          {interview.documents.map((path) => (
            <Link key={path} to={`/applications/${application.slug}/doc/${path}`} className="interview-document">
              {documentName(path)}
            </Link>
          ))}
        </li>
      ))}
    </ul>
  )
}

function documentName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}
