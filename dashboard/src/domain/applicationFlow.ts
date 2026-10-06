import { preparationSummary, type Preparation } from './applicationPreparation.ts'
import { INITIAL_STATUS } from './constants.ts'
import { formatDate } from './format.ts'
import { JOB_DESCRIPTION_FILE } from './jobDescription.ts'
import type { ApplicationData } from './schema.ts'

export const FLOW_STEP_IDS = ['posting', 'details', 'preparation', 'submit'] as const
export type FlowStepId = (typeof FLOW_STEP_IDS)[number]
export type FlowStepStatus = 'completed' | 'active' | 'pending'
export type FlowStep = { id: FlowStepId; label: string; status: FlowStepStatus; to: string | null; hint?: string }
/** `slug: null` is a draft that does not exist yet: its steps cannot be navigated to. */
export type FlowApplication = { slug: string | null; documents: Record<string, string>; data: Pick<ApplicationData, 'company' | 'role' | 'status' | 'apply_url' | 'applied_at'> }
type Translate = (key: string, values?: Record<string, unknown>) => string

const ROUTES: Record<FlowStepId, string> = { posting: 'job-description', details: 'edit', preparation: 'preparation', submit: 'submit' }

/** Only http(s) links count: the link may come from an AI reading of the posting. */
export function validApplyUrl(url: string | null | undefined) {
  return url && /^https?:\/\//i.test(url) ? url : null
}

export function isInFlow(application: Pick<FlowApplication, 'data'>) {
  return application.data.status === INITIAL_STATUS
}

/** `preparation` is `undefined` while loading and `null` when not started. Completion comes from the data, never from where the user clicked. */
export function applicationFlowSteps(application: FlowApplication, preparation: Preparation | null | undefined, currentStep: FlowStepId | null, t: Translate) {
  const { data } = application
  const submitted = !isInFlow(application)
  const summary = preparation ? preparationSummary(preparation) : null
  const preparationHint = () => {
    if (preparation === undefined) return undefined
    if (!summary) return t('flow.hints.not_started')
    if (summary.total === 0) return t('flow.hints.no_items')
    return t('flow.hints.progress', { accepted: summary.accepted, total: summary.total })
  }
  const rules: Record<FlowStepId, { done: boolean; pendingHint?: string; doneHint?: string }> = {
    posting: { done: JOB_DESCRIPTION_FILE in application.documents, pendingHint: t('flow.hints.no_posting') },
    details: { done: !!data.company.trim() && !!data.role.trim() && !!validApplyUrl(data.apply_url), pendingHint: t('flow.hints.no_apply_link') },
    // Not `summary.status === 'READY'`: that also needs the form inspection, which belongs to the submit step.
    preparation: { done: !!summary && summary.total > 0 && summary.accepted === summary.total, pendingHint: preparationHint() },
    submit: { done: submitted, doneHint: data.applied_at && t('flow.hints.submitted_on', { date: formatDate(data.applied_at) }) },
  }
  const done = (id: FlowStepId) => submitted || rules[id].done
  const steps: FlowStep[] = FLOW_STEP_IDS.map(id => ({
    id, label: t(`flow.steps.${id}`),
    status: id === currentStep ? 'active' : done(id) ? 'completed' : 'pending',
    to: application.slug === null ? null : `/applications/${application.slug}/${ROUTES[id]}`,
    hint: done(id) ? rules[id].doneHint : rules[id].pendingHint,
  }))
  return { steps, nextStep: FLOW_STEP_IDS.find(id => !done(id)) ?? null }
}
