import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { request } from '../data/loadApplications'
import { confirmDiscard, useUnsavedGuard } from '../components/useUnsavedGuard'
import { AUTHORIZATION_STATES, SPONSORSHIP_STATES, NOTICE_TYPES, NOTICE_UNITS, REMOTE_PREFERENCES, LANGUAGE_LEVELS, emptyPersonalProfile, personalProfileSchema, type PersonalProfile, type PersonalProfileFields } from '../domain/personalProfile'
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS, RATE_PERIODS } from '../domain/constants'
import { todayIsoDate } from '../domain/format'

export function PersonalProfilePage() {
  const { t } = useTranslation('pages')
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
      {nullable && <option value="">{t('not_set', { ns: 'common' })}</option>}{options.map(o => <option key={o} value={o}>{key === 'salaryPeriod' ? t(`rate_period.${o}`, { ns: 'common' }) : t(`personal_profile.options.${o.toLowerCase()}`)}</option>)}
    </select>{error(key)}</label>
  }
  async function save() {
    const validation = personalProfileSchema.safeParse(form)
    if (!validation.success) { setErrors(Object.fromEntries(validation.error.issues.map(i => [i.path.join('.'), i.message]))); setMessage(t('fix_fields', { ns: 'common' })); return }
    setBusy(true); setMessage(''); setErrors({})
    try { accept((await request<{ profile: PersonalProfile }>('/profile', 'PUT', { ...validation.data, revision })).profile); setMessage(t('personal_profile.profile_saved')) }
    catch (e) {
      const failure = e as Error & { status?: number; fields?: Record<string, string> }
      setMessage(failure.message); setErrors(failure.fields ?? {}); setConflict(failure.status === 409)
    } finally { setBusy(false) }
  }
  if (loading) return <p role="status">{t('personal_profile.loading_personal_profile')}</p>
  if (loadError) return <article><h1>{t('personal_profile.personal_profile')}</h1><p role="alert">{loadError}</p><button onClick={() => void load()}>{t('retry', { ns: 'common' })}</button></article>
  return <article className="detail"><h1>{t('personal_profile.personal_profile')}</h1>
    {revision === null && <p>{t('personal_profile.no_profile_hint')}</p>}
    <form className="application-form" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset disabled={busy}><legend>{t('personal_profile.personal_information')}</legend><div className="form-grid">
        {input('name', t('personal_profile.name'))}{input('email', t('personal_profile.email'), 'email')}{input('phone', t('personal_profile.phone'), 'tel')}{input('gender', t('personal_profile.gender'))}{input('city', t('personal_profile.current_city'))}{input('country', t('personal_profile.current_country_iso_code_e_g_pt'))}
        {input('linkedin', t('personal_profile.linkedin'), 'url')}{input('github', t('personal_profile.github'), 'url')}{input('website', t('personal_profile.website'), 'url')}
      </div></fieldset>
      <fieldset disabled={busy}><legend>{t('personal_profile.work_eligibility_and_availability')}</legend>
        {error('workAuthorizations')}
        {form.workAuthorizations.map((item, i) => <fieldset key={i}><legend>{t('personal_profile.country_number', { number: i + 1 })}</legend><div className="form-grid">
          <label>{t('personal_profile.country_code')}<input value={item.country} aria-invalid={!!errors[`workAuthorizations.${i}.country`]} onChange={e => set({ workAuthorizations: form.workAuthorizations.map((v, n) => n === i ? { ...v, country: e.target.value } : v) })} />{error(`workAuthorizations.${i}.country`)}</label>
          {(['authorization', 'sponsorship'] as const).map(key => <label key={key}>{key === 'authorization' ? t('personal_profile.work_authorization') : t('personal_profile.need_sponsorship')}<select value={item[key]} onChange={e => set({ workAuthorizations: form.workAuthorizations.map((v, n) => n === i ? { ...v, [key]: e.target.value } : v) })}>
            {(key === 'authorization' ? AUTHORIZATION_STATES : SPONSORSHIP_STATES).map(o => <option key={o} value={o}>{t(`personal_profile.options.${o.toLowerCase()}`)}</option>)}
          </select>{error(`workAuthorizations.${i}.${key}`)}</label>)}
          <label>{t('personal_profile.authorization_notes')}<textarea value={item.notes ?? ''} onChange={e => set({ workAuthorizations: form.workAuthorizations.map((v, n) => n === i ? { ...v, notes: e.target.value || null } : v) })} />{error(`workAuthorizations.${i}.notes`)}</label>
        </div><button type="button" onClick={() => set({ workAuthorizations: form.workAuthorizations.filter((_, n) => n !== i) })}>{t('personal_profile.remove_country', { number: i + 1 })}</button></fieldset>)}
        <button type="button" onClick={() => set({ workAuthorizations: [...form.workAuthorizations, { country: '', authorization: 'unknown', sponsorship: 'unknown', notes: null }] })}>{t('personal_profile.add_country')}</button>
        <div className="form-grid">{input('yearsOfExperience', t('personal_profile.years_of_experience'))}
          <label>{t('personal_profile.notice_period')}<select value={form.noticeType} onChange={e => set({ noticeType: e.target.value as PersonalProfileFields['noticeType'], noticeQuantity: null, noticeUnit: null })}>{NOTICE_TYPES.map(o => <option key={o} value={o}>{t(`personal_profile.options.${o.toLowerCase()}`)}</option>)}</select>{error('noticeType')}</label>
          {form.noticeType === 'duration' && <><label>{t('personal_profile.notice_quantity')}<input type="number" min="1" step="1" value={form.noticeQuantity ?? ''} onChange={e => set({ noticeQuantity: e.target.value === '' ? null : Number(e.target.value) })} />{error('noticeQuantity')}</label>{select('noticeUnit', t('personal_profile.notice_unit'), NOTICE_UNITS)}</>}
          {input('availableFrom', t('personal_profile.available_from'), 'date')}
        </div>
        {form.noticeType === 'immediate' && form.availableFrom && form.availableFrom > todayIsoDate() && <p role="status">{t('personal_profile.availability_conflict_hint')}</p>}
      </fieldset>
      <fieldset disabled={busy}><legend>{t('personal_profile.professional_preferences')}</legend><div className="form-grid">
        {input('salaryExpected', t('personal_profile.default_salary_expectation'))}{input('salaryMinimum', t('personal_profile.minimum_salary'))}{input('salaryCurrency', t('personal_profile.currency_e_g_eur'))}{select('salaryPeriod', t('personal_profile.salary_period'), RATE_PERIODS)}
        <label>{t('personal_profile.vat')}<select value={form.salaryVat === null ? '' : String(form.salaryVat)} onChange={e => set({ salaryVat: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">{t('not_set', { ns: 'common' })}</option><option value="true">{t('yes', { ns: 'common' })}</option><option value="false">{t('no', { ns: 'common' })}</option></select>{error('salaryVat')}</label>
        {select('remotePreference', t('personal_profile.remote_preference'), REMOTE_PREFERENCES)}
      </div><fieldset><legend>{t('personal_profile.preferred_contract')}</legend>{CONTRACT_TYPES.map(type => <label key={type}><input type="checkbox" checked={form.contractPreferences.includes(type)} onChange={e => set({ contractPreferences: e.target.checked ? [...form.contractPreferences, type] : form.contractPreferences.filter(v => v !== type) })} />{t(CONTRACT_TYPE_LABELS[type], { ns: 'status' })}</label>)}{error('contractPreferences')}</fieldset></fieldset>
      <fieldset disabled={busy}><legend>{t('personal_profile.languages')}</legend>{error('languages')}
        {form.languages.map((item, i) => <fieldset key={i}><legend>{t('personal_profile.language_number', { number: i + 1 })}</legend><div className="form-grid">
          <label>{t('personal_profile.language_code_e_g_en_pt')}<input value={item.code} aria-invalid={!!errors[`languages.${i}.code`]} onChange={e => set({ languages: form.languages.map((v, n) => n === i ? { ...v, code: e.target.value } : v) })} />{error(`languages.${i}.code`)}</label>
          <label>{t('personal_profile.level')}<select value={item.level} onChange={e => set({ languages: form.languages.map((v, n) => n === i ? { ...v, level: e.target.value as typeof v.level } : v) })}>{LANGUAGE_LEVELS.map(o => <option key={o} value={o}>{t(`personal_profile.options.${o.toLowerCase()}`)}</option>)}</select>{error(`languages.${i}.level`)}</label>
        </div><button type="button" onClick={() => set({ languages: form.languages.filter((_, n) => n !== i) })}>{t('personal_profile.remove_language', { number: i + 1 })}</button></fieldset>)}
        <button type="button" onClick={() => set({ languages: [...form.languages, { code: '', level: 'unspecified' }] })}>{t('personal_profile.add_language')}</button>
      </fieldset>
      <button disabled={busy}>{busy ? t('saving', { ns: 'common' }) : t('personal_profile.save_profile')}</button><p role="status">{message}</p>
      {conflict && <button type="button" disabled={busy} onClick={() => { if (confirmDiscard(dirty)) void load() }}>{t('load_current_version', { ns: 'common' })}</button>}
    </form>
  </article>
}
