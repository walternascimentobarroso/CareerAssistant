import { isDeepStrictEqual } from 'node:util'
import { normalizeText, type AnswerValue, type KnowledgeEntry, type Restriction } from '../dashboard/src/domain/knowledge.ts'
import { answerFits, type EvidenceSource, type PreparationAnswer, type ProfileConcept, type Requirement, type ResolutionContext } from '../dashboard/src/domain/applicationPreparation.ts'
import type { PersonalProfile } from '../dashboard/src/domain/personalProfile.ts'

export type Resolution = Pick<PreparationAnswer, 'answer' | 'source' | 'confidence' | 'evidence' | 'reviewReason' | 'approval'>

const textAnswer = (value: string | null): AnswerValue | null => value ? { type: 'text', value } : null
// An unknown or unlisted country stays unknown: residence never implies authorization.
function eligibility(profile: PersonalProfile, context: ResolutionContext, field: 'authorization' | 'sponsorship', positive: string): AnswerValue | null {
  const state = profile.workAuthorizations.find(item => item.country === context.country)?.[field]
  return !state || state === 'unknown' ? null : { type: 'boolean', value: state === positive }
}
const profileAnswers: Record<ProfileConcept, (profile: PersonalProfile, context: ResolutionContext) => AnswerValue | null> = {
  'personal.name': p => textAnswer(p.name), 'personal.email': p => textAnswer(p.email), 'personal.phone': p => textAnswer(p.phone),
  'personal.gender': p => textAnswer(p.gender),
  'personal.city': p => textAnswer(p.city), 'personal.country': p => textAnswer(p.country),
  'personal.linkedin': p => textAnswer(p.linkedin), 'personal.github': p => textAnswer(p.github), 'personal.website': p => textAnswer(p.website),
  'experience.years_total': p => p.yearsOfExperience ? { type: 'number', value: p.yearsOfExperience } : null,
  'work_authorization.authorized': (p, c) => eligibility(p, c, 'authorization', 'authorized'),
  'work_authorization.requires_sponsorship': (p, c) => eligibility(p, c, 'sponsorship', 'yes'),
}

export function contextValues(context: ResolutionContext): Record<Restriction['type'], string | null> {
  return { COUNTRY: context.country, LOCATION: context.location && normalizeText(context.location), CONTRACT_TYPE: context.contractType,
    COMPANY: context.companyId, JOB: context.jobId, APPLICATION: context.applicationId }
}
function conceptsForQuestion(question: string, entries: KnowledgeEntry[]) {
  const wanted = normalizeText(question)
  return [...new Set(entries.filter(entry => [entry.question, ...entry.aliases].some(known => normalizeText(known) === wanted)).map(entry => entry.concept))]
}
const unresolved = (reviewReason: string, evidence: Resolution['evidence'] = null): Resolution =>
  ({ answer: null, source: 'UNKNOWN', confidence: 'UNKNOWN', evidence, reviewReason, approval: 'pending' })

/** Deterministic: explicit profile and confirmed knowledge only. Anything ambiguous is left for the user. */
export function resolveAnswer(requirement: Requirement, context: ResolutionContext, profile: PersonalProfile | null, entries: KnowledgeEntry[]): Resolution {
  const concepts = requirement.concept ? [requirement.concept] : conceptsForQuestion(requirement.question, entries)
  if (!concepts.length) return unresolved('No stored answer matches this question.')
  if (concepts.length > 1) return unresolved(`This question matches several concepts (${concepts.join(', ')}). Choose one.`)
  const concept = concepts[0]
  const sources: EvidenceSource[] = []
  const values = contextValues(context)
  const fromProfile = profile && profileAnswers[concept as ProfileConcept]?.(profile, context)
  if (profile && fromProfile) sources.push({ kind: 'PROFILE', id: profile.id, revision: profile.revision, label: 'Personal profile', answer: fromProfile })
  for (const entry of entries) {
    if (entry.concept !== concept || !entry.confirmed || entry.language !== context.language || !entry.context.every(item => values[item.type] === item.value)) continue
    sources.push({ kind: 'KNOWLEDGE_BASE', id: entry.id, revision: entry.revision, label: entry.question, answer: entry.answer })
  }
  if (!sources.length) return unresolved('No stored answer applies to this application context.')
  const evidence = { concept, context, sources }
  const answer = sources[0].answer
  if (sources.some(source => !isDeepStrictEqual(source.answer, answer))) return unresolved('Stored answers conflict. Choose the correct one.', evidence)
  if (!answerFits(requirement, answer)) return unresolved('The stored answer does not fit this field type or its options.', evidence)
  return { answer, source: sources[0].kind, confidence: 'VERIFIED', evidence, reviewReason: null, approval: 'accepted' }
}
