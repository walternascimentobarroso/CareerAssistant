import { z } from 'zod'
import { decimalAmount } from './money.ts'
import { CONTRACT_TYPES, RATE_PERIODS } from './constants.ts'

// Lenient on purpose: a model's answer is a proposal to review, so a bad value is dropped instead of failing the whole extraction.
const text = z.string().trim().min(1).optional().catch(undefined)
const amount = decimalAmount.optional().catch(undefined)
const list = z
  .array(z.unknown())
  .catch([])
  .transform((items) => items.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))

export const suggestionSchema = z.object({
  company: text,
  role: text,
  location: text,
  job_url: text,
  type: z.enum(CONTRACT_TYPES).optional().catch(undefined),
  rate: z
    .object({
      requested: amount,
      minimum: amount,
      currency: z.string().regex(/^[A-Z]{3}$/).optional().catch(undefined),
      period: z.enum(RATE_PERIODS).optional().catch(undefined),
      vat: z.boolean().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  contact: z.object({ name: text, role: text, email: text, phone: text, linkedin: text }).optional().catch(undefined),
  tags: list,
  keyRequirements: list,
  niceToHave: list,
  technologies: list,
})

export type Suggestion = z.infer<typeof suggestionSchema>
