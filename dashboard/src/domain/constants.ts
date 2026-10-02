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

export const STATUS_LABELS: Record<Status, string> = {
  interested: 'Interested',
  applied: 'Applied',
  recruiter: 'Recruiter',
  technical_interview: 'Technical Interview',
  final_interview: 'Final Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  archived: 'Archived',
}

export const PRIORITIES = ['high', 'medium', 'low'] as const

export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const CONTRACT_TYPES = ['permanent', 'b2b', 'contract'] as const

export type ContractType = (typeof CONTRACT_TYPES)[number]

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  permanent: 'Permanent',
  b2b: 'B2B',
  contract: 'Contract',
}

export const RATE_PERIODS = ['hour', 'day', 'month', 'year'] as const

export const TASK_GROUPS = ['overdue', 'today', 'upcoming', 'no_date'] as const

export type TaskGroup = (typeof TASK_GROUPS)[number]

export const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  no_date: 'No date',
}

export const CLOSED_STATUSES: readonly Status[] = ['accepted', 'rejected', 'archived']
