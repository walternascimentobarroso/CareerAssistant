import { useTranslation } from 'react-i18next'
import { TASK_GROUP_LABELS } from '../domain/constants'
import { formatDate, todayIsoDate } from '../domain/format'
import type { NextAction } from '../domain/schema'
import { taskGroupOf } from '../domain/tasks'

export function NextActionBox({ action }: { action: NextAction }) {
  const { t } = useTranslation('status')
  const group = taskGroupOf(action, todayIsoDate())

  return (
    <div className={`next-action due-${group}`}>
      <span className="next-action-description">{action.description}</span>
      <span className="next-action-date">
        {action.date ? formatDate(action.date) : t(TASK_GROUP_LABELS.no_date)}
        {group === 'overdue' && ` · ${t(TASK_GROUP_LABELS.overdue)}`}
        {group === 'today' && ` · ${t(TASK_GROUP_LABELS.today)}`}
      </span>
    </div>
  )
}
