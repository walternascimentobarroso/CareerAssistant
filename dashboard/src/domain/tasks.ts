import type { Application } from './applications'
import type { TaskGroup } from './constants'
import type { NextAction } from './schema'

export type Task = { application: Application; action: NextAction; group: TaskGroup }

export function taskGroupOf(action: NextAction, today: string): TaskGroup {
  if (!action.date) return 'no_date'
  if (action.date < today) return 'overdue'
  if (action.date === today) return 'today'
  return 'upcoming'
}

export function listTasks(applications: Application[], today: string): Task[] {
  return applications
    .flatMap((application) => {
      const action = application.data.next_action
      return action ? [{ application, action, group: taskGroupOf(action, today) }] : []
    })
    .sort((a, b) => (a.action.date ?? '').localeCompare(b.action.date ?? ''))
}
