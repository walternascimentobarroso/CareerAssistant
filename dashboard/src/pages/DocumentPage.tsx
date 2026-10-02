import Markdown from 'react-markdown'
import { Link, useParams } from 'react-router'
import { findApplication } from '../data/loadApplications'

export function DocumentPage() {
  const { slug, '*': path = '' } = useParams()
  const application = findApplication(slug)
  const content = application?.documents[path]
  if (!application || content === undefined) return <p className="muted">Document not found.</p>

  return (
    <article className="detail">
      <Link to={`/applications/${application.slug}`} className="back">
        ← {application.data.company} — {application.data.role}
      </Link>
      <p className="muted">
        applications/{application.slug}/{path}
      </p>
      <div className="markdown">
        <Markdown>{content}</Markdown>
      </div>
    </article>
  )
}
