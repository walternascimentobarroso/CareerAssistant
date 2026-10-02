import { ApplicationCard } from '../components/ApplicationCard'
import { applications } from '../data/loadApplications'
import { STATUSES, STATUS_LABELS } from '../domain/constants'

export function KanbanPage() {
  return (
    <div className="board">
      {STATUSES.map((status) => {
        const inColumn = applications.filter((application) => application.data.status === status)
        return (
          <section key={status} className="column">
            <h2>
              {STATUS_LABELS[status]} <span className="count">{inColumn.length}</span>
            </h2>
            {inColumn.map((application) => (
              <ApplicationCard key={application.slug} application={application} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
