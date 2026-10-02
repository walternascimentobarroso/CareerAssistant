import type { InputHTMLAttributes, ReactNode } from 'react'
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS, RATE_PERIODS } from '../domain/constants'
import type { ApplicationFormValues, FieldErrors } from '../domain/applicationForm'

type TextKey = { [K in keyof ApplicationFormValues]: ApplicationFormValues[K] extends string ? K : never }[keyof ApplicationFormValues]
type Props = { value: ApplicationFormValues; errors: FieldErrors; disabled: boolean; onChange: (value: ApplicationFormValues) => void; suggested?: ReadonlySet<keyof ApplicationFormValues> }

export function ApplicationForm({ value, errors, disabled, onChange, suggested }: Props) {
  const set = (changes: Partial<ApplicationFormValues>) => onChange({ ...value, ...changes })
  const input = (key: TextKey, label: string, path: string, attributes: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} error={errors[path]} suggested={suggested?.has(key)}>
      <input value={value[key]} disabled={disabled} aria-invalid={path in errors} onChange={e => set({ [key]: e.target.value })} {...attributes} />
    </Field>
  )
  const select = (key: TextKey, label: string, path: string, options: readonly string[], labels: Record<string, string> | null, allowEmpty: boolean) => (
    <Field label={label} error={errors[path]} suggested={suggested?.has(key)}>
      <select value={value[key]} disabled={disabled} onChange={e => set({ [key]: e.target.value })}>
        {allowEmpty && <option value="">Not set</option>}
        {options.map(option => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
      </select>
    </Field>
  )
  return <>
    <fieldset>
      <legend>Job</legend>
      <div className="form-grid">
        {input('company', 'Company *', 'company', { required: true })}
        {input('role', 'Role *', 'role', { required: true })}
        {input('location', 'Location', 'location', { placeholder: 'Remote' })}
        {input('job_url', 'Job posting URL', 'job_url', { type: 'url', placeholder: 'https://…' })}
        {select('priority', 'Priority', 'priority', PRIORITIES, PRIORITY_LABELS, true)}
        {select('type', 'Contract type', 'type', CONTRACT_TYPES, CONTRACT_TYPE_LABELS, true)}
        {input('applied_at', 'Applied on', 'applied_at', { type: 'date' })}
        {input('tags', 'Tags (comma separated)', 'tags', { placeholder: 'php, symfony, backend' })}
      </div>
    </fieldset>
    <fieldset>
      <legend>Salary or rate</legend>
      <div className="form-grid">
        {input('rateRequested', 'Requested', 'rate.requested', { type: 'number', min: 0 })}
        {input('rateMinimum', 'Minimum', 'rate.minimum', { type: 'number', min: 0 })}
        {input('rateCurrency', 'Currency', 'rate.currency', { placeholder: 'EUR', maxLength: 3 })}
        {select('ratePeriod', 'Per', 'rate.period', RATE_PERIODS, null, false)}
        <label><input type="checkbox" checked={value.rateVat} disabled={disabled} onChange={e => set({ rateVat: e.target.checked })} /> Plus VAT</label>
      </div>
    </fieldset>
    <fieldset>
      <legend>Contact</legend>
      <div className="form-grid">
        {input('contactName', 'Name', 'contact.name')}
        {input('contactRole', 'Role', 'contact.role', { placeholder: 'Recruiter' })}
        {input('contactEmail', 'Email', 'contact.email', { type: 'email' })}
        {input('contactPhone', 'Phone', 'contact.phone', { type: 'tel' })}
        {input('contactLinkedin', 'LinkedIn', 'contact.linkedin', { type: 'url' })}
      </div>
    </fieldset>
    <fieldset>
      <legend>Next action</legend>
      <div className="form-grid">
        {input('actionType', 'Type', 'next_action.type', { placeholder: 'follow_up' })}
        {input('actionDate', 'Date', 'next_action.date', { type: 'date' })}
        {input('actionDescription', 'What has to happen', 'next_action.description')}
      </div>
    </fieldset>
  </>
}

function Field({ label, error, suggested, children }: { label: string; error?: string; suggested?: boolean; children: ReactNode }) {
  return <label className={suggested ? 'suggested' : undefined}>{label}{suggested && ' · filled by AI, please check'}{children}{error && <span className="field-error">{error}</span>}</label>
}
