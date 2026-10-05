import { z } from 'zod'
import { decimalAmount } from './money.ts'
import { CONTRACT_TYPES, RATE_PERIODS } from './constants.ts'
import { COUNTRY_CODES, LANGUAGE_CODES } from './personalProfile.ts'

export const ANSWER_TYPES = ['text', 'boolean', 'number', 'single_select', 'multi_select', 'money'] as const
export type AnswerType = (typeof ANSWER_TYPES)[number]
export const KNOWLEDGE_CATEGORIES = ['work_authorization', 'experience', 'compensation', 'availability', 'relocation', 'personal', 'motivation', 'other'] as const
/** An entry without restrictions is GLOBAL. */
export const SCOPE_TYPES = ['COUNTRY', 'LOCATION', 'CONTRACT_TYPE', 'COMPANY', 'JOB', 'APPLICATION'] as const
export type ScopeType = (typeof SCOPE_TYPES)[number]
export const ANSWER_SOURCES = ['PROFILE', 'KNOWLEDGE_BASE', 'CV', 'AI_INFERRED', 'AI_GENERATED', 'USER', 'UNKNOWN'] as const
export type AnswerSource = (typeof ANSWER_SOURCES)[number]

/** Questions and locations match only when equal after removing case, accents and punctuation. */
export function normalizeText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
const text = (max: number) => z.string().trim().min(1).max(max)
export const conceptSchema = z.string().trim().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, 'Use lowercase words separated by dots, e.g. experience.symfony')
export const countrySchema = z.string().trim().toUpperCase().refine(v => COUNTRY_CODES.includes(v), 'Use an ISO country code')
export const languageSchema = z.string().trim().toLowerCase().refine(v => LANGUAGE_CODES.includes(v), 'Use an ISO language code')

export const answerValueSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), value: text(20_000) }),
  z.strictObject({ type: z.literal('boolean'), value: z.boolean() }),
  z.strictObject({ type: z.literal('number'), value: z.string().trim().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/, 'Use a non-negative decimal number') }),
  z.strictObject({ type: z.literal('single_select'), value: text(500) }),
  z.strictObject({ type: z.literal('multi_select'), value: z.array(text(500)).min(1).max(100) }),
  z.strictObject({ type: z.literal('money'), amount: decimalAmount, currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'), period: z.enum(RATE_PERIODS) }),
])
export type AnswerValue = z.infer<typeof answerValueSchema>

const restrictionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('COUNTRY'), value: countrySchema }),
  z.strictObject({ type: z.literal('LOCATION'), value: text(200).transform(normalizeText).refine(v => v !== '', 'Use letters or digits') }),
  z.strictObject({ type: z.literal('CONTRACT_TYPE'), value: z.enum(CONTRACT_TYPES) }),
  z.strictObject({ type: z.enum(['COMPANY', 'JOB', 'APPLICATION']), value: z.uuid() }),
])
export type Restriction = z.infer<typeof restrictionSchema>
export const contextSchema = z.array(restrictionSchema).max(SCOPE_TYPES.length)
  .refine(items => new Set(items.map(item => item.type)).size === items.length, 'Use each restriction type once')
export function contextKey(context: Restriction[]) {
  return context.map(item => `${item.type}=${item.value}`).sort().join('&')
}

export const knowledgeFieldsSchema = z.strictObject({
  concept: conceptSchema, question: text(2000), language: languageSchema, category: z.enum(KNOWLEDGE_CATEGORIES),
  answer: answerValueSchema, context: contextSchema,
  aliases: z.array(text(2000)).max(50).refine(items => new Set(items.map(normalizeText)).size === items.length, 'Duplicate aliases are not allowed'),
  confirmed: z.boolean(),
})
export type KnowledgeFields = z.infer<typeof knowledgeFieldsSchema>
export const saveKnowledgeSchema = z.strictObject({ ...knowledgeFieldsSchema.shape, revision: z.string().regex(/^[1-9]\d*$/) })
export type KnowledgeEntry = KnowledgeFields & { id: string; revision: string; origin: AnswerSource; confirmedAt: string | null }

export function formatAnswer(answer: AnswerValue | null) {
  if (!answer) return '—'
  if (answer.type === 'money') return `${answer.amount} ${answer.currency}/${answer.period}`
  if (answer.type === 'boolean') return answer.value ? 'Yes' : 'No'
  if (answer.type === 'multi_select') return answer.value.join(', ')
  return answer.value
}
