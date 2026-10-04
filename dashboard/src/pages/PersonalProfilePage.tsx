import { useEffect, useState } from 'react'
import { request } from '../data/loadApplications'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { AUTHORIZATION_STATES, SPONSORSHIP_STATES, NOTICE_TYPES, NOTICE_UNITS, REMOTE_PREFERENCES, LANGUAGE_LEVELS, emptyPersonalProfile, personalProfileSchema, type PersonalProfile, type PersonalProfileFields } from '../domain/personalProfile'
import { CONTRACT_TYPES, RATE_PERIODS } from '../domain/constants'
import { todayIsoDate } from '../domain/format'

export function PersonalProfilePage() {
  const [form, setForm] = useState<PersonalProfileFields>(emptyPersonalProfile)
  const [revision, setRevision] = useState<string | null>(null)
  const [saved, setSaved] = useState(JSON.stringify(emptyPersonalProfile))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = JSON.stringify(form) !== saved
  useUnsavedGuard(dirty)
  function accept(profile: PersonalProfile | null) {
    const { id: _id, revision: version, ...fields } = profile ?? { ...emptyPersonalProfile, id: '', revision: null }
    setForm(fields); setSaved(JSON.stringify(fields)); setRevision(version); setErrors({}); setConflict(false)
  }
  async function load() {
    setLoading(true); setLoadError('')
    try { accept((await request<{ profile: PersonalProfile | null }>('/profile')).profile) }
    catch (e) { setLoadError((e as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const set = (changes: Partial<PersonalProfileFields>) => { setForm({ ...form, ...changes }); setMessage('') }
  const error = (path: string) => errors[path] && <span className="field-error" id={`profile-error-${path}`} role="alert">{errors[path]}</span>
  function input(key: keyof PersonalProfileFields, label: string, type = 'text') {
    return <label>{label}<input type={type} value={String(form[key] ?? '')} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `profile-error-${key}` : undefined} onChange={e => set({ [key]: e.target.value || null })} />{error(key)}</label>
  }
  function select(key: keyof PersonalProfileFields, label: string, options: readonly string[], nullable = true) {
    return <label>{label}<select value={String(form[key] ?? '')} aria-invalid={!!errors[key]} onChange={e => set({ [key]: e.target.value || null })}>
      {nullable && <option value="">Not set</option>}{options.map(o => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
    </select>{error(key)}</label>
  }
  async function save() {
    const validation = personalProfileSchema.safeParse(form)
    if (!validation.success) { setErrors(Object.fromEntries(validation.error.issues.map(i => [i.path.join('.'), i.message]))); setMessage('Fix the highlighted fields.'); return }
    setBusy(true); setMessage(''); setErrors({})
    try { accept((await request<{ profile: PersonalProfile }>('/profile', 'PUT', { ...validation.data, revision })).profile); setMessage('Profile saved.') }
    catch (e) {
      const failure = e as Error & { status?: number; fields?: Record<string, string> }
      setMessage(failure.message); setErrors(failure.fields ?? {}); setConflict(failure.status === 409)
    } finally { setBusy(false) }
  }
  if (loading) return <p role="status">Loading personal profile…</p>
  if (loadError) return <article><h1>Personal profile</h1><p role="alert">{loadError}</p><button onClick={() => void load()}>Retry</button></article>
  return <article className="detail"><h1>Personal profile</h1>
    {revision === null && <p>No profile saved yet. All fields are optional; you can save a partial profile.</p>}
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset disabled={busy}><legend>Personal information</legend><div className="form-grid">
        {input('name', 'Name')}{input('email', 'Email', 'email')}{input('phone', 'Phone', 'tel')}{input('city', 'Current city')}{input('country', 'Current country (ISO code, e.g. PT)')}
        {input('linkedin', 'LinkedIn', 'url')}{input('github', 'GitHub', 'url')}{input('website', 'Website', 'url')}
      </div></fieldset>
      <fieldset disabled={busy}><legend>Work eligibility and availability</legend>
        {error('workAuthorizations')}
        {form.workAuthorizations.map((item, i) => <fieldset key={i}><legend>Country {i + 1}</legend><div className="form-grid">
          <label>Country code<input value={item.country} aria-invalid={!!errors[`workAuthorizations.${i}.country`]} onChange={e => set({ workAuthorizations: form.workAuthorizations.map((v, n) => n === i ? { ...v, country: e.target.value } : v) })} />{error(`workAuthorizations.${i}.country`)}</label>
          {(['authorization', 'sponsorship'] as const).map(key => <label key={key}>{key === 'authorization' ? 'Work authorization' : 'Need sponsorship?'}<select value={item[key]} onChange={e => set({ workAuthorizations: form.workAuthorizations.map((v, n) => n === i ? { ...v, [key]: e.target.value } : v) })}>
            {(key === 'authorization' ? AUTHORIZATION_STATES : SPONSORSHIP_STATES).map(o => <option key={o}>{o}</option>)}
          </select>{error(`workAuthorizations.${i}.${key}`)}</label>)}
          <label>Authorization notes<textarea value={item.notes ?? ''} onChange={e => set({ workAuthorizations: form.workAuthorizations.map((v, n) => n === i ? { ...v, notes: e.target.value || null } : v) })} />{error(`workAuthorizations.${i}.notes`)}</label>
        </div><button type="button" onClick={() => set({ workAuthorizations: form.workAuthorizations.filter((_, n) => n !== i) })}>Remove country {i + 1}</button></fieldset>)}
        <button type="button" onClick={() => set({ workAuthorizations: [...form.workAuthorizations, { country: '', authorization: 'unknown', sponsorship: 'unknown', notes: null }] })}>Add country</button>
        <div className="form-grid">{input('yearsOfExperience', 'Years of experience')}
          <label>Notice period<select value={form.noticeType} onChange={e => set({ noticeType: e.target.value as PersonalProfileFields['noticeType'], noticeQuantity: null, noticeUnit: null })}>{NOTICE_TYPES.map(o => <option key={o}>{o}</option>)}</select>{error('noticeType')}</label>
          {form.noticeType === 'duration' && <><label>Notice quantity<input type="number" min="1" step="1" value={form.noticeQuantity ?? ''} onChange={e => set({ noticeQuantity: e.target.value === '' ? null : Number(e.target.value) })} />{error('noticeQuantity')}</label>{select('noticeUnit', 'Notice unit', NOTICE_UNITS)}</>}
          {input('availableFrom', 'Available from', 'date')}
        </div>
        {form.noticeType === 'immediate' && form.availableFrom && form.availableFrom > todayIsoDate() && <p role="status">A future availability date may conflict with immediate availability. Review both fields.</p>}
      </fieldset>
      <fieldset disabled={busy}><legend>Professional preferences</legend><div className="form-grid">
        {input('salaryExpected', 'Default salary expectation')}{input('salaryMinimum', 'Minimum salary')}{input('salaryCurrency', 'Currency (e.g. EUR)')}{select('salaryPeriod', 'Salary period', RATE_PERIODS)}
        <label>VAT<select value={form.salaryVat === null ? '' : String(form.salaryVat)} onChange={e => set({ salaryVat: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>{error('salaryVat')}</label>
        {select('remotePreference', 'Remote preference', REMOTE_PREFERENCES)}
      </div><fieldset><legend>Preferred contract</legend>{CONTRACT_TYPES.map(type => <label key={type}><input type="checkbox" checked={form.contractPreferences.includes(type)} onChange={e => set({ contractPreferences: e.target.checked ? [...form.contractPreferences, type] : form.contractPreferences.filter(v => v !== type) })} />{type}</label>)}{error('contractPreferences')}</fieldset></fieldset>
      <fieldset disabled={busy}><legend>Languages</legend>{error('languages')}
        {form.languages.map((item, i) => <fieldset key={i}><legend>Language {i + 1}</legend><div className="form-grid">
          <label>Language code (e.g. en, pt)<input value={item.code} aria-invalid={!!errors[`languages.${i}.code`]} onChange={e => set({ languages: form.languages.map((v, n) => n === i ? { ...v, code: e.target.value } : v) })} />{error(`languages.${i}.code`)}</label>
          <label>Level<select value={item.level} onChange={e => set({ languages: form.languages.map((v, n) => n === i ? { ...v, level: e.target.value as typeof v.level } : v) })}>{LANGUAGE_LEVELS.map(o => <option key={o}>{o}</option>)}</select>{error(`languages.${i}.level`)}</label>
        </div><button type="button" onClick={() => set({ languages: form.languages.filter((_, n) => n !== i) })}>Remove language {i + 1}</button></fieldset>)}
        <button type="button" onClick={() => set({ languages: [...form.languages, { code: '', level: 'unspecified' }] })}>Add language</button>
      </fieldset>
      <button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button><p role="status">{message}</p>
      {conflict && <button type="button" disabled={busy} onClick={() => { if (confirmDiscard(dirty)) void load() }}>Load current version</button>}
    </form>
  </article>
}
