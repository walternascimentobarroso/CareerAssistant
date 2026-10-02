import { z } from 'zod'
import { CONTRACT_TYPES, PRIORITIES, RATE_PERIODS, STATUSES } from './constants'

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

const isoDate = z.string().refine(isIsoDate, 'expected a real date as YYYY-MM-DD')

const rateSchema = z.strictObject({
  requested: z.number().positive().optional(),
  minimum: z.number().positive().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'expected a 3-letter currency code like EUR'),
  period: z.enum(RATE_PERIODS),
  vat: z.boolean().optional(),
})

const contactSchema = z.strictObject({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  linkedin: z.string().optional(),
})

const nextActionSchema = z.strictObject({
  type: z.string().min(1),
  date: isoDate.optional(),
  description: z.string().min(1),
})

const timelineEntrySchema = z.strictObject({
  date: isoDate,
  type: z.string().min(1),
  description: z.string().min(1),
})

// Strict on purpose: a typo like `next_actoin` must fail validation instead of silently dropping a task.
export const applicationSchema = z.strictObject({
  company: z.string().min(1),
  role: z.string().min(1),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(CONTRACT_TYPES).optional(),
  location: z.string().optional(),
  applied_at: isoDate.optional(),
  job_url: z.string().optional(),
  rate: rateSchema.optional(),
  contact: contactSchema.optional(),
  next_action: nextActionSchema.optional(),
  cv: z.string().optional(),
  tags: z.array(z.string()).default([]),
  timeline: z.array(timelineEntrySchema).default([]),
})

export type ApplicationData = z.infer<typeof applicationSchema>
export type Rate = z.infer<typeof rateSchema>
export type NextAction = z.infer<typeof nextActionSchema>
