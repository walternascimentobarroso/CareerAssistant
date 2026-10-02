import { AttachCv } from '../components/AttachCv'
import type { ReactNode } from 'react'
import Markdown from 'react-markdown'
import { Link, useParams } from 'react-router'
import { Badges } from '../components/Badges'
import { NextActionBox } from '../components/NextActionBox'
import { useApplications } from '../data/loadApplications'
import type { Application } from '../domain/applications'
import { STATUS_LABELS } from '../domain/constants'
import { formatDate, formatRate, humanize } from '../domain/format'

const TOP_LEVEL_DOCUMENTS = [
  { path: 'job-description.md', label: 'Job Description' },
  { path: 'cv.md', label: 'CV sent' },
]

export function ApplicationPage() {
  const { findApplication } = useApplications()
  const application = findApplication(useParams().slug)
  if (!application) return <p className="muted">Application not found.</p>

  const { data, notes } = application
  const timeline = [...data.timeline].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <article className="detail">
      <Link to="/" className="back">
        ← Board
      </Link>
      <header>
        <h1>{data.company}</h1>
        <p className="detail-role">{data.role}</p>
        <div className="detail-meta">
          <span className="badge status">{STATUS_LABELS[data.status]}</span>
          <Badges data={data} />
          {data.location && <span className="muted">{data.location}</span>}
          {data.applied_at && <span className="muted">Applied {formatDate(data.applied_at)}</span>}
          {data.job_url && (
            <a href={data.job_url} target="_blank" rel="noreferrer">
              Job posting ↗
            </a>
          )}
        </div>
      </header>

      {data.next_action && (
        <Section title="Next Action">
          <NextActionBox action={data.next_action} />
        </Section>
      )}

      <div className="detail-grid">
        {data.rate && (
          <Section title="Rate">
            {data.rate.requested !== undefined && <p>Requested: {formatRate(data.rate.requested, data.rate)}</p>}
            {data.rate.minimum !== undefined && <p>Minimum: {formatRate(data.rate.minimum, data.rate)}</p>}
          </Section>
        )}

        {data.contact && (
          <Section title="Contact">
            <p>{data.contact.name}</p>
            {data.contact.role && <p className="muted">{data.contact.role}</p>}
            {data.contact.email && <p>{data.contact.email}</p>}
            {data.contact.phone && <p>{data.contact.phone}</p>}
            {data.contact.linkedin && <p>{data.contact.linkedin}</p>}
          </Section>
        )}

        <Section title="Documents">
          <DocumentLinks application={application} />
          <AttachCv application={application} />
        </Section>

        <Section title="Interviews">
          <InterviewLinks application={application} />
        </Section>
      </div>

      <Section title="Timeline">
        {timeline.length === 0 && <p className="muted">No events yet.</p>}
        <ol className="timeline">
          {timeline.map((entry) => (
            <li key={`${entry.date}-${entry.description}`}>
              <span className="timeline-date">{formatDate(entry.date)}</span>
              <span className="badge">{humanize(entry.type)}</span>
              <span>{entry.description}</span>
            </li>
          ))}
        </ol>
      </Section>

      {data.tags.length > 0 && (
        <Section title="Tags">
          <div className="badges">
            {data.tags.map((tag) => (
              <span key={tag} className="badge">
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}

      {notes && (
        <Section title="Notes">
          <div className="markdown">
            <Markdown>{notes}</Markdown>
          </div>
        </Section>
      )}
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
  const available = TOP_LEVEL_DOCUMENTS.filter(({ path }) => path in application.documents)
  if (available.length === 0) return <p className="muted">No documents yet.</p>

  return (
    <ul className="links">
      {available.map(({ path, label }) => (
        <li key={path}>
          <Link to={`/applications/${application.slug}/doc/${path}`}>{label}</Link>
        </li>
      ))}
    </ul>
  )
}

function InterviewLinks({ application }: { application: Application }) {
  if (application.interviews.length === 0) return <p className="muted">No interviews yet.</p>

  return (
    <ul className="links">
      {application.interviews.map((interview) => (
        <li key={interview.slug}>
          {interview.title}
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
