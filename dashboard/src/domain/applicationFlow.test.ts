import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applicationFlowSteps, isInFlow, type FlowApplication, type FlowStepId } from './applicationFlow.ts'
import type { Preparation, PreparationAnswer } from './applicationPreparation.ts'
import { JOB_DESCRIPTION_FILE } from './jobDescription.ts'

const t = (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key
const application = (changes: Partial<FlowApplication['data']> = {}, documents: Record<string, string> = {}): FlowApplication =>
  ({ slug: 'acme-engineer', documents, data: { company: 'Acme', role: 'Engineer', status: 'interested', ...changes } })
const answer = (changes: Partial<PreparationAnswer> = {}): PreparationAnswer => ({
  id: 'answer', question: 'Notice period?', concept: null, type: 'text', options: [], required: true, answer: { type: 'text', value: 'One month' },
  source: 'USER', confidence: 'VERIFIED', evidence: null, reviewReason: null, approval: 'accepted', approvedAt: null, ...changes,
})
const preparation = (answers: PreparationAnswer[], changes: Partial<Preparation> = {}): Preparation =>
  ({ id: 'preparation', applicationId: 'application', revision: '1', country: null, language: 'en', cvRequired: false, cv: null, formInspected: false, answers, ...changes })
const step = (id: FlowStepId, subject: FlowApplication, loaded?: Preparation | null, current: FlowStepId | null = null) =>
  applicationFlowSteps(subject, loaded, current, t).steps.find(candidate => candidate.id === id)!

test('posting step is completed once the job description document exists', () => {
  assert.deepEqual(step('posting', application()), { id: 'posting', label: 'flow.steps.posting', status: 'pending', to: '/applications/acme-engineer/job-description', hint: 'flow.hints.no_posting' })
  const saved = step('posting', application({}, { [JOB_DESCRIPTION_FILE]: '# Posting' }))
  assert.equal(saved.status, 'completed')
  assert.equal(saved.hint, undefined)
})

test('details step needs company, role and an http(s) application link', () => {
  const complete = { apply_url: 'https://acme.test/apply' }
  assert.equal(step('details', application(complete)).status, 'completed')
  assert.equal(step('details', application({ apply_url: 'HTTP://acme.test/apply' })).status, 'completed')
  for (const incomplete of [{}, { apply_url: null }, { apply_url: 'javascript:alert(1)' }, { ...complete, company: '  ' }, { ...complete, role: '' }]) {
    const pending = step('details', application(incomplete))
    assert.equal(pending.status, 'pending', JSON.stringify(incomplete))
    assert.equal(pending.hint, 'flow.hints.no_apply_link')
  }
})

test('preparation step is completed when every known required item is accepted', () => {
  assert.equal(step('preparation', application(), preparation([answer()])).status, 'completed')
  // Completion must not wait for the form inspection, which belongs to the submit step.
  assert.equal(step('preparation', application(), preparation([answer()], { formInspected: false })).status, 'completed')
  assert.equal(step('preparation', application(), preparation([answer(), answer({ id: 'optional', required: false, answer: null, approval: 'pending' })])).status, 'completed')

  const loading = step('preparation', application(), undefined)
  assert.equal(loading.status, 'pending')
  assert.equal(loading.hint, undefined)
  assert.equal(step('preparation', application(), null).hint, 'flow.hints.not_started')
  assert.equal(step('preparation', application(), preparation([])).hint, 'flow.hints.no_items')

  const partial = step('preparation', application(), preparation([answer(), answer({ id: 'pending', approval: 'pending' })]))
  assert.equal(partial.status, 'pending')
  assert.equal(partial.hint, 'flow.hints.progress {"accepted":1,"total":2}')
  const missingCv = step('preparation', application(), preparation([answer()], { cvRequired: true }))
  assert.equal(missingCv.status, 'pending')
  assert.equal(missingCv.hint, 'flow.hints.progress {"accepted":1,"total":2}')
  assert.equal(step('preparation', application(), preparation([answer()], { cvRequired: true, cv: { versionId: 'version', name: 'Master', version: 2 } })).status, 'completed')
})

test('submit step is completed when the application left the initial status', () => {
  const pending = step('submit', application())
  assert.equal(pending.status, 'pending')
  assert.equal(pending.hint, undefined)
  const applied = step('submit', application({ status: 'applied', applied_at: '2026-10-06' }))
  assert.equal(applied.status, 'completed')
  assert.equal(applied.hint, 'flow.hints.submitted_on {"date":"06/10/2026"}')
  assert.equal(step('submit', application({ status: 'rejected' })).hint, undefined)
})

test('a submitted application shows every step completed without pending hints', () => {
  const { steps, nextStep } = applicationFlowSteps(application({ status: 'applied' }), null, null, t)
  assert.deepEqual(steps.map(candidate => candidate.status), ['completed', 'completed', 'completed', 'completed'])
  assert.deepEqual(steps.map(candidate => candidate.hint), [undefined, undefined, undefined, undefined])
  assert.equal(nextStep, null)
})

test('nextStep is the first step that is not completed, regardless of the current step', () => {
  const posting = { [JOB_DESCRIPTION_FILE]: '# Posting' }
  const details = { apply_url: 'https://acme.test/apply' }
  assert.equal(applicationFlowSteps(application(), null, null, t).nextStep, 'posting')
  assert.equal(applicationFlowSteps(application({}, posting), null, null, t).nextStep, 'details')
  assert.equal(applicationFlowSteps(application(details, posting), null, null, t).nextStep, 'preparation')
  assert.equal(applicationFlowSteps(application(details, posting), preparation([answer()]), null, t).nextStep, 'submit')
  // An earlier step left incomplete stays the next one even when the user is further ahead.
  assert.equal(applicationFlowSteps(application(details), preparation([answer()]), 'preparation', t).nextStep, 'posting')
})

test('the current step is shown as active and a draft without slug cannot be navigated', () => {
  const current = applicationFlowSteps(application({}, { [JOB_DESCRIPTION_FILE]: '# Posting' }), null, 'posting', t)
  assert.equal(current.steps[0].status, 'active')
  assert.equal(current.nextStep, 'details')
  const draft = applicationFlowSteps({ ...application(), slug: null }, undefined, 'posting', t)
  assert.deepEqual(draft.steps.map(candidate => candidate.to), [null, null, null, null])
})

test('isInFlow is true only for the initial status', () => {
  assert.equal(isInFlow(application()), true)
  for (const status of ['applied', 'recruiter', 'rejected', 'archived'] as const) assert.equal(isInFlow(application({ status })), false, status)
})
