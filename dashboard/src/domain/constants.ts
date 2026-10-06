export const STATUSES = [
  'interested',
  'applied',
  'recruiter',
  'technical_interview',
  'final_interview',
  'offer',
  'accepted',
  'rejected',
  'archived',
] as const

export type Status = (typeof STATUSES)[number]

export const INITIAL_STATUS: Status = 'interested'

export const APPLIED_STATUS: Status = 'applied'

export const STATUS_LABELS: Record<Status, string> = {
  interested: 'status.interested',
  applied: 'status.applied',
  recruiter: 'status.recruiter',
  technical_interview: 'status.technical_interview',
  final_interview: 'status.final_interview',
  offer: 'status.offer',
  accepted: 'status.accepted',
  rejected: 'status.rejected',
  archived: 'status.archived',
}

export const PRIORITIES = ['high', 'medium', 'low'] as const

export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
}

export const CONTRACT_TYPES = ['permanent', 'b2b', 'contract'] as const

export type ContractType = (typeof CONTRACT_TYPES)[number]

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  permanent: 'contract_type.permanent',
  b2b: 'contract_type.b2b',
  contract: 'contract_type.contract',
}

/** Offered in the form; the schema still accepts any 3-letter code written by hand. */
export const CURRENCIES = ['EUR', 'USD', 'BRL', 'GBP', 'CHF'] as const

export const RATE_PERIODS = ['hour', 'day', 'month', 'year'] as const

/** Offered in the Add event form; the schema still accepts any label written by hand. */
export const TIMELINE_EVENT_TYPES = ['contact', 'interview', 'follow_up', 'offer', 'applied', 'rejected', 'other'] as const

export const TASK_GROUPS = ['overdue', 'today', 'upcoming', 'no_date'] as const

export type TaskGroup = (typeof TASK_GROUPS)[number]

export const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: 'task_group.overdue',
  today: 'task_group.today',
  upcoming: 'task_group.upcoming',
  no_date: 'task_group.no_date',
}

export const CLOSED_STATUSES: readonly Status[] = ['accepted', 'rejected', 'archived']
