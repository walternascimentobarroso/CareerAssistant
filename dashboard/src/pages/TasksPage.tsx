import { Link } from 'react-router'
import { applications } from '../data/loadApplications'
import { TASK_GROUPS, TASK_GROUP_LABELS } from '../domain/constants'
import { formatDate, todayIsoDate } from '../domain/format'
import { listTasks } from '../domain/tasks'

export function TasksPage() {
  const tasks = listTasks(applications, todayIsoDate())

  return (
    <div className="tasks">
      {TASK_GROUPS.map((group) => {
        const inGroup = tasks.filter((task) => task.group === group)
        return (
          <section key={group} className={`task-group due-${group}`}>
            <h2>
              {TASK_GROUP_LABELS[group]} <span className="count">{inGroup.length}</span>
            </h2>
            {inGroup.length === 0 && <p className="muted">Nothing here.</p>}
            {inGroup.map(({ application, action }) => (
              <Link key={application.slug} to={`/applications/${application.slug}`} className="task">
                <span className="task-description">{action.description}</span>
                <span className="muted">
                  {application.data.company} — {application.data.role}
                </span>
                {action.date && <span className="task-date">{formatDate(action.date)}</span>}
              </Link>
            ))}
          </section>
        )
      })}
    </div>
  )
}
