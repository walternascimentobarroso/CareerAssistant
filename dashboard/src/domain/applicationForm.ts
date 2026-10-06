import { INITIAL_STATUS, RATE_PERIODS } from './constants'
import { applicationSchema, type ApplicationData } from './schema'
import type { Suggestion } from './suggestion'

export type ApplicationFormValues = {
  company: string
  role: string
  priority: string
  type: string
  location: string
  applied_at: string
  job_url: string
  apply_url?: string | null
  rateRequested: string
  rateMinimum: string
  rateCurrency: string
  ratePeriod: string
  rateVat: boolean
  rateBasis: string
  contactName: string
  contactRole: string
  contactEmail: string
  contactPhone: string
  contactLinkedin: string
  actionType: string
  actionDate: string
  actionDescription: string
  tags: string
}

/** Keyed by schema path (`rate.currency`), so each message can be shown next to its input. */
export type FieldErrors = Record<string, string>

export function formFromApplication(data?: ApplicationData): ApplicationFormValues {
  return {
    company: data?.company ?? '',
    role: data?.role ?? '',
    priority: data?.priority ?? '',
    type: data?.type ?? '',
    location: data?.location ?? '',
    applied_at: data?.applied_at ?? '',
    job_url: data?.job_url ?? '',
    apply_url: data?.apply_url ?? '',
    rateRequested: data?.rate?.requested?.toString() ?? '',
    rateMinimum: data?.rate?.minimum?.toString() ?? '',
    rateCurrency: data?.rate?.currency ?? '',
    ratePeriod: data?.rate?.period ?? RATE_PERIODS[1],
    rateVat: data?.rate?.vat ?? false,
    rateBasis: data?.rate?.basis ?? 'personal_expectation',
    contactName: data?.contact?.name ?? '',
    contactRole: data?.contact?.role ?? '',
    contactEmail: data?.contact?.email ?? '',
    contactPhone: data?.contact?.phone ?? '',
    contactLinkedin: data?.contact?.linkedin ?? '',
    actionType: data?.next_action?.type ?? '',
    actionDate: data?.next_action?.date ?? '',
    actionDescription: data?.next_action?.description ?? '',
    tags: data?.tags.join(', ') ?? '',
  }
}

export function formFromSuggestion(suggestion: Suggestion): ApplicationFormValues {
  const blank = formFromApplication()
  return {
    ...blank,
    company: suggestion.company ?? '',
    role: suggestion.role ?? '',
    type: suggestion.type ?? '',
    location: suggestion.location ?? '',
    job_url: suggestion.job_url ?? '',
    apply_url: suggestion.apply_url ?? '',
    rateRequested: suggestion.rate?.requested?.toString() ?? '',
    rateMinimum: suggestion.rate?.minimum?.toString() ?? '',
    rateCurrency: suggestion.rate?.currency ?? '',
    ratePeriod: suggestion.rate?.period ?? blank.ratePeriod,
    rateVat: suggestion.rate?.vat ?? false,
    rateBasis: 'advertised_range',
    contactName: suggestion.contact?.name ?? '',
    contactRole: suggestion.contact?.role ?? '',
    contactEmail: suggestion.contact?.email ?? '',
    contactPhone: suggestion.contact?.phone ?? '',
    contactLinkedin: suggestion.contact?.linkedin ?? '',
    tags: suggestion.tags.join(', '),
  }
}

export function changedKeys(before: ApplicationFormValues, after: ApplicationFormValues) {
  return (Object.keys(after) as (keyof ApplicationFormValues)[]).filter((key) => before[key] !== after[key])
}

/** `null` means "remove this field"; optional fields are never written empty. */
export function fieldsFromForm(form: ApplicationFormValues, initial?: ApplicationData) {
  return {
    company: form.company.trim(),
    role: form.role.trim(),
    priority: optionalText(form.priority) ?? null,
    type: optionalText(form.type) ?? null,
    location: optionalText(form.location) ?? null,
    applied_at: optionalText(form.applied_at) ?? null,
    job_url: optionalText(form.job_url) ?? null,
    apply_url: optionalText(form.apply_url ?? '') ?? null,
    rate: rateFromForm(form, initial),
    contact: contactFromForm(form),
    next_action: nextActionFromForm(form),
    tags: [...new Set(form.tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
  }
}

export function validateFields(fields: Record<string, unknown>): FieldErrors {
  const present = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null))
  const validation = applicationSchema.safeParse({ ...present, status: INITIAL_STATUS })
  if (validation.success) return {}

  const errors: FieldErrors = {}
  for (const issue of validation.error.issues) {
    const emptyText = issue.code === 'too_small' && issue.origin === 'string'
    errors[issue.path.join('.')] ??= emptyText ? 'Required' : issue.message
  }
  return errors
}

function rateFromForm(form: ApplicationFormValues, initial?: ApplicationData) {
  if (!form.rateRequested && !form.rateMinimum && !form.rateCurrency.trim()) return null
  // An explicit `vat: false` already in the file is kept instead of being silently dropped.
  const vat = form.rateVat || initial?.rate?.vat !== undefined ? form.rateVat : undefined
  return {
    requested: optionalAmount(form.rateRequested),
    minimum: optionalAmount(form.rateMinimum),
    basis: form.rateBasis,
    currency: form.rateCurrency.trim().toUpperCase(),
    period: form.ratePeriod,
    vat,
  }
}

function contactFromForm(form: ApplicationFormValues) {
  const details = [form.contactName, form.contactRole, form.contactEmail, form.contactPhone, form.contactLinkedin]
  if (details.every((detail) => !detail.trim())) return null
  return {
    name: form.contactName.trim(),
    role: optionalText(form.contactRole),
    email: optionalText(form.contactEmail),
    phone: optionalText(form.contactPhone),
    linkedin: optionalText(form.contactLinkedin),
  }
}

function nextActionFromForm(form: ApplicationFormValues) {
  if (!form.actionType.trim() && !form.actionDate && !form.actionDescription.trim()) return null
  return {
    type: form.actionType.trim().toLowerCase().replace(/\s+/g, '_'),
    date: optionalText(form.actionDate),
    description: form.actionDescription.trim(),
  }
}

function optionalText(text: string) {
  return text.trim() || undefined
}

function optionalAmount(text: string) {
  return text === '' ? undefined : text.trim()
}
