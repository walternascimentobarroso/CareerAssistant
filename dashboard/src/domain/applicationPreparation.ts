import { z } from 'zod'
import { ANSWER_TYPES, KNOWLEDGE_CATEGORIES, SCOPE_TYPES, answerValueSchema, conceptSchema, countrySchema, languageSchema, type AnswerSource, type AnswerValue } from './knowledge.ts'

export const CONFIDENCES = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'REVIEW_REQUIRED', 'UNKNOWN'] as const
export type Confidence = (typeof CONFIDENCES)[number]
export const APPROVALS = ['pending', 'accepted', 'rejected'] as const
export type Approval = (typeof APPROVALS)[number]
export const PREPARATION_STATUSES = ['NOT_READY', 'NEEDS_REVIEW', 'READY', 'SUBMITTING', 'SUBMITTED', 'FAILED'] as const
export type PreparationStatus = (typeof PREPARATION_STATUSES)[number]
/** Concepts answered from the personal profile instead of the knowledge base. */
export const PROFILE_CONCEPTS = ['personal.name', 'personal.email', 'personal.phone', 'personal.city', 'personal.country', 'personal.linkedin', 'personal.github', 'personal.website',
  'experience.years_total', 'work_authorization.authorized', 'work_authorization.requires_sponsorship'] as const
export type ProfileConcept = (typeof PROFILE_CONCEPTS)[number]

const revision = z.string().regex(/^[1-9]\d*$/)
const requirementShape = {
  question: z.string().trim().min(1).max(2000), concept: conceptSchema.nullable(), type: z.enum(ANSWER_TYPES),
  options: z.array(z.string().trim().min(1).max(500)).max(100), required: z.boolean(),
}
export type Requirement = z.infer<z.ZodObject<typeof requirementShape>>
const isSelect = (type: string) => type === 'single_select' || type === 'multi_select'
const optionsMatchType = (v: Pick<Requirement, 'type' | 'options'>) => isSelect(v.type) ? v.options.length > 0 : v.options.length === 0
const optionsIssue = { path: ['options'], message: 'Selections need options; other types have none' }
export const addAnswerSchema = z.strictObject({ ...requirementShape, revision }).refine(optionsMatchType, optionsIssue)
const rememberSchema = z.strictObject({ concept: conceptSchema, category: z.enum(KNOWLEDGE_CATEGORIES), scopes: z.array(z.enum(SCOPE_TYPES)) })
export const saveAnswerSchema = z.strictObject({ ...requirementShape, answer: answerValueSchema.nullable(), approval: z.enum(APPROVALS), remember: rememberSchema.optional(), revision })
  .refine(optionsMatchType, optionsIssue)
export type SaveAnswer = z.infer<typeof saveAnswerSchema>
export const preparationContextSchema = z.strictObject({ country: countrySchema.nullable(), language: languageSchema, cvRequired: z.boolean(), revision })
export const revisionSchema = z.strictObject({ revision })

export type ResolutionContext = { country: string | null; language: string; location: string | null; contractType: string | null; companyId: string; jobId: string; applicationId: string }
export type EvidenceSource = { kind: 'PROFILE' | 'KNOWLEDGE_BASE'; id: string; revision: string; label: string; answer: AnswerValue }
export type Evidence = { concept: string; context: ResolutionContext; sources: EvidenceSource[] }
export type PreparationAnswer = Requirement & {
  id: string; answer: AnswerValue | null; source: AnswerSource; confidence: Confidence
  evidence: Evidence | null; reviewReason: string | null; approval: Approval; approvedAt: string | null
}
export type Preparation = {
  id: string; applicationId: string; revision: string; country: string | null; language: string; cvRequired: boolean
  cv: { versionId: string; name: string; version: number } | null
  /** True after the browser inspected and filled the required form fields. */
  formInspected: boolean; answers: PreparationAnswer[]
}

export function answerFits(requirement: Pick<Requirement, 'type' | 'options'>, answer: AnswerValue) {
  if (answer.type !== requirement.type) return false
  if (answer.type === 'single_select') return requirement.options.includes(answer.value)
  if (answer.type === 'multi_select') return answer.value.every(value => requirement.options.includes(value))
  return true
}

/** Completeness covers only the known required items, never the form that was not inspected. */
export function preparationSummary(preparation: Pick<Preparation, 'answers' | 'cvRequired' | 'cv' | 'formInspected'>) {
  const required = preparation.answers.filter(answer => answer.required)
  const cvItems = preparation.cvRequired ? 1 : 0
  const total = required.length + cvItems
  const missing = required.filter(answer => !answer.answer || answer.approval === 'rejected').length + (preparation.cv ? 0 : cvItems)
  const accepted = required.filter(answer => answer.answer && answer.approval === 'accepted').length + (preparation.cv ? cvItems : 0)
  const status: PreparationStatus = total === 0 || missing > 0 ? 'NOT_READY' : accepted === total && preparation.formInspected ? 'READY' : 'NEEDS_REVIEW'
  return { total, accepted, missing, pending: total - accepted - missing, completeness: total === 0 ? null : Math.floor(accepted * 100 / total), status }
}
