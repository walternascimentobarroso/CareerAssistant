import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextKey, knowledgeFieldsSchema, type KnowledgeEntry } from '../dashboard/src/domain/knowledge'
import { addAnswerSchema, preparationSummary, saveAnswerSchema, type PreparationAnswer, type Requirement, type ResolutionContext } from '../dashboard/src/domain/applicationPreparation'
import { emptyPersonalProfile, type PersonalProfile } from '../dashboard/src/domain/personalProfile'
import { resolveAnswer } from './application-answer-resolver'

const uuid = (digit: number) => `00000000-0000-4000-8000-00000000000${digit}`
const context: ResolutionContext = { country: 'DE', language: 'en', location: 'Berlin', contractType: 'permanent', companyId: uuid(1), jobId: uuid(2), applicationId: uuid(3) }
const profile: PersonalProfile = { ...emptyPersonalProfile, id: uuid(4), revision: '7', name: 'Ada', country: 'PT',
  workAuthorizations: [{ country: 'DE', authorization: 'authorized', sponsorship: 'no', notes: null }, { country: 'US', authorization: 'unknown', sponsorship: 'unknown', notes: null }] }
const fields = { concept: 'relocation.willing', question: 'Are you willing to relocate?', language: 'en', category: 'relocation', answer: { type: 'boolean', value: true }, context: [], aliases: [], confirmed: true }
let sequence = 0
const entry = (changes: Record<string, unknown> = {}): KnowledgeEntry => ({ ...knowledgeFieldsSchema.parse({ ...fields, ...changes }), id: uuid(5 + sequence++ % 5), revision: '1', origin: 'USER', confirmedAt: null })
const question = (changes: Partial<Requirement> = {}): Requirement => ({ question: 'Are you willing to relocate?', concept: null, type: 'boolean', options: [], required: true, ...changes })

test('knowledge entries validate typed answers and normalize their context', () => {
  const parsed = knowledgeFieldsSchema.parse({ ...fields, context: [{ type: 'LOCATION', value: ' Berlín ' }, { type: 'COUNTRY', value: 'de' }] })
  assert.equal(contextKey(parsed.context), 'COUNTRY=DE&LOCATION=berlin')
  assert.equal(contextKey([...parsed.context].reverse()), contextKey(parsed.context))
  const money = { type: 'money', amount: '900719925474099.1234', currency: 'EUR', period: 'year' }
  assert.deepEqual(knowledgeFieldsSchema.parse({ ...fields, answer: money }).answer, money)
  for (const changes of [
    { concept: 'Experience Symfony' }, { language: 'zz' }, { answer: { type: 'boolean', value: 'yes' } }, { answer: { ...money, amount: 100 } }, { answer: { ...money, amount: '1.12345' } },
    { context: [{ type: 'COUNTRY', value: 'DE' }, { type: 'COUNTRY', value: 'US' }] }, { context: [{ type: 'COMPANY', value: 'acme' }] }, { context: [{ type: 'CONTRACT_TYPE', value: 'daily' }] },
    { aliases: ['Will you relocate?', 'will you relocate'] },
  ]) assert.equal(knowledgeFieldsSchema.safeParse({ ...fields, ...changes }).success, false, JSON.stringify(changes))
})
test('questions need options only for selections', () => {
  const base = { ...question(), revision: '1' }
  assert.equal(addAnswerSchema.safeParse(base).success, true)
  assert.equal(addAnswerSchema.safeParse({ ...base, options: ['Yes'] }).success, false)
  assert.equal(addAnswerSchema.safeParse({ ...base, type: 'single_select' }).success, false)
  assert.equal(saveAnswerSchema.safeParse({ ...base, type: 'single_select', options: ['Yes', 'No'], answer: null, approval: 'pending' }).success, true)
})
test('profile answers require an explicit, known value for the job country', () => {
  const sponsorship = question({ question: 'Do you need sponsorship?', concept: 'work_authorization.requires_sponsorship' })
  const resolved = resolveAnswer(sponsorship, context, profile, [])
  assert.deepEqual([resolved.answer, resolved.source, resolved.confidence, resolved.approval], [{ type: 'boolean', value: false }, 'PROFILE', 'VERIFIED', 'accepted'])
  assert.deepEqual(resolved.evidence?.sources.map(source => [source.id, source.revision]), [[profile.id, '7']])
  // Residence, an unknown state, an unlisted country and a missing country never become an answer.
  for (const country of ['US', 'PT', null]) {
    const unknown = resolveAnswer(sponsorship, { ...context, country }, profile, [])
    assert.deepEqual([unknown.answer, unknown.source, unknown.approval], [null, 'UNKNOWN', 'pending'])
  }
  assert.equal(resolveAnswer(sponsorship, context, null, []).answer, null)
  assert.deepEqual(resolveAnswer(question({ concept: 'personal.name', type: 'text' }), context, profile, []).answer, { type: 'text', value: 'Ada' })
})
test('knowledge answers are reused only for a compatible language and context', () => {
  const berlin = entry({ context: [{ type: 'LOCATION', value: 'Berlin' }] })
  assert.equal(resolveAnswer(question(), context, profile, [berlin]).source, 'KNOWLEDGE_BASE')
  assert.equal(resolveAnswer(question(), { ...context, location: 'Munich' }, profile, [berlin]).answer, null)
  assert.equal(resolveAnswer(question(), { ...context, location: null }, profile, [berlin]).answer, null)
  assert.equal(resolveAnswer(question(), { ...context, language: 'de' }, profile, [berlin]).answer, null)
  const yearly = entry({ concept: 'compensation.expected', question: 'Salary expectation?', answer: { type: 'money', amount: '80000', currency: 'EUR', period: 'year' },
    context: [{ type: 'CONTRACT_TYPE', value: 'permanent' }, { type: 'COUNTRY', value: 'DE' }] })
  const salary = question({ question: 'salary expectation', type: 'money' })
  assert.equal(resolveAnswer(salary, context, profile, [yearly]).confidence, 'VERIFIED')
  assert.equal(resolveAnswer(salary, { ...context, contractType: 'b2b' }, profile, [yearly]).answer, null)
  assert.equal(resolveAnswer(salary, { ...context, country: 'PT' }, profile, [yearly]).answer, null)
  assert.equal(resolveAnswer(question(), context, profile, [entry({ context: [{ type: 'COMPANY', value: uuid(9) }] })]).answer, null)
  assert.equal(resolveAnswer(question(), context, profile, [entry({ confirmed: false })]).answer, null)
})
test('aliases match exact wording only and never merge different qualifiers', () => {
  const current = entry({ concept: 'work_authorization.requires_sponsorship.current', question: 'Do you currently require sponsorship?', aliases: ['Do you need a visa now?'], answer: { type: 'boolean', value: false } })
  const future = entry({ concept: 'work_authorization.requires_sponsorship.future', question: 'Will you require sponsorship in the future?', answer: { type: 'boolean', value: true } })
  const ask = (text: string) => resolveAnswer(question({ question: text }), context, null, [current, future])
  assert.deepEqual(ask('do you need a VISA now').answer, { type: 'boolean', value: false })
  assert.deepEqual(ask('Will you require sponsorship in the future?').answer, { type: 'boolean', value: true })
  assert.equal(ask('Do you require sponsorship?').answer, null)
  const ambiguous = resolveAnswer(question({ question: 'Do you need a visa now?' }), context, null, [current, entry({ concept: 'other.visa', question: 'Do you need a visa now?' })])
  assert.equal(ambiguous.answer, null)
  assert.match(ambiguous.reviewReason!, /several concepts/)
})
test('conflicting or unfit stored answers are left for review with their evidence', () => {
  const conflict = resolveAnswer(question(), context, profile, [entry(), entry({ answer: { type: 'boolean', value: false }, context: [{ type: 'COUNTRY', value: 'DE' }] })])
  assert.deepEqual([conflict.answer, conflict.approval, conflict.evidence?.sources.length], [null, 'pending', 2])
  assert.match(conflict.reviewReason!, /conflict/)
  const agreeing = resolveAnswer(question(), context, profile, [entry(), entry({ context: [{ type: 'COUNTRY', value: 'DE' }] })])
  assert.equal(agreeing.approval, 'accepted')
  const profileConflict = resolveAnswer(question({ concept: 'personal.name', type: 'text' }), context, profile, [entry({ concept: 'personal.name', answer: { type: 'text', value: 'Ada L.' } })])
  assert.equal(profileConflict.answer, null)
  const unfit = resolveAnswer(question({ type: 'single_select', options: ['Yes', 'No'] }), context, profile, [entry()])
  assert.deepEqual([unfit.answer, unfit.evidence?.sources.length], [null, 1])
})
test('completeness counts only accepted required items and never reports an uninspected form as ready', () => {
  const answer = (changes: Partial<PreparationAnswer>): PreparationAnswer => ({ ...question(), id: uuid(1), answer: { type: 'boolean', value: true }, source: 'USER', confidence: 'VERIFIED', evidence: null, reviewReason: null, approval: 'accepted', approvedAt: null, ...changes })
  const cv = { versionId: uuid(2), name: 'master', version: 1 }
  assert.deepEqual(preparationSummary({ answers: [], cvRequired: false, cv: null, formInspected: true }), { total: 0, accepted: 0, missing: 0, pending: 0, completeness: null, status: 'NOT_READY' })
  assert.deepEqual(preparationSummary({ answers: [answer({}), answer({ approval: 'pending' }), answer({ required: false, answer: null, approval: 'pending' })], cvRequired: true, cv, formInspected: false }),
    { total: 3, accepted: 2, missing: 0, pending: 1, completeness: 66, status: 'NEEDS_REVIEW' })
  assert.equal(preparationSummary({ answers: [answer({ answer: null, approval: 'pending' })], cvRequired: false, cv: null, formInspected: true }).status, 'NOT_READY')
  assert.equal(preparationSummary({ answers: [answer({ approval: 'rejected' })], cvRequired: false, cv: null, formInspected: true }).status, 'NOT_READY')
  assert.equal(preparationSummary({ answers: [answer({})], cvRequired: true, cv: null, formInspected: true }).status, 'NOT_READY')
  const complete = { answers: [answer({})], cvRequired: true, cv }
  assert.deepEqual([preparationSummary({ ...complete, formInspected: false }).completeness, preparationSummary({ ...complete, formInspected: false }).status], [100, 'NEEDS_REVIEW'])
  assert.equal(preparationSummary({ ...complete, formInspected: true }).status, 'READY')
})
