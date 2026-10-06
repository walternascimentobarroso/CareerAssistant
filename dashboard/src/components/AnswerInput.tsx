import { useTranslation } from 'react-i18next'
import { RATE_PERIODS } from '../domain/constants'
import type { AnswerType, AnswerValue } from '../domain/knowledge'

type Props = { type: AnswerType; options: string[]; value: AnswerValue | null; onChange: (value: AnswerValue | null) => void }

/** Emits the draft as typed; the shared schema validates it on save. */
export function AnswerInput({ type, options, value, onChange }: Props) {
  const { t } = useTranslation('common')
  if (type === 'boolean') {
    const selected = value?.type === 'boolean' ? String(value.value) : ''
    return <label>{t('answer_input.answer')}<select value={selected} onChange={e => onChange(e.target.value === '' ? null : { type, value: e.target.value === 'true' })}>
      <option value="">{t('not_set')}</option><option value="true">{t('yes')}</option><option value="false">{t('no')}</option>
    </select></label>
  }
  if (type === 'money') {
    const money = value?.type === 'money' ? value : { type, amount: '', currency: '', period: RATE_PERIODS[3] }
    const set = (changes: Partial<typeof money>) => { const next = { ...money, ...changes }; onChange(next.amount || next.currency ? next : null) }
    return <div className="form-grid">
      <label>{t('answer_input.amount')}<input value={money.amount} onChange={e => set({ amount: e.target.value.trim() })} /></label>
      <label>{t('answer_input.currency_e_g_eur')}<input value={money.currency} onChange={e => set({ currency: e.target.value.trim().toUpperCase() })} /></label>
      <label>{t('answer_input.period')}<select value={money.period} onChange={e => set({ period: e.target.value as typeof money.period })}>{RATE_PERIODS.map(period => <option key={period} value={period}>{t(`rate_period.${period}`)}</option>)}</select></label>
    </div>
  }
  if (type === 'multi_select') {
    const selected = value?.type === 'multi_select' ? value.value : []
    const set = (next: string[]) => onChange(next.length ? { type, value: next } : null)
    if (!options.length) return <label>{t('answer_input.answers_comma_separated')}<input value={selected.join(', ')} onChange={e => set(e.target.value.split(',').map(item => item.trimStart()).filter((item, index, all) => item || index === all.length - 1))} /></label>
    return <fieldset><legend>{t('answer_input.answer')}</legend>{options.map(option => <label key={option}>
      <input type="checkbox" checked={selected.includes(option)} onChange={e => set(e.target.checked ? [...selected, option] : selected.filter(item => item !== option))} />{option}
    </label>)}</fieldset>
  }
  const text = value && value.type === type && typeof value.value === 'string' ? value.value : ''
  const set = (next: string) => onChange(next ? { type, value: next } : null)
  if (type === 'single_select' && options.length) return <label>{t('answer_input.answer')}<select value={text} onChange={e => set(e.target.value)}>
    <option value="">{t('not_set')}</option>{options.map(option => <option key={option}>{option}</option>)}
  </select></label>
  if (type === 'text') return <label>{t('answer_input.answer')}<textarea rows={4} value={text} onChange={e => set(e.target.value)} /></label>
  return <label>{t('answer_input.answer')}<input value={text} onChange={e => set(e.target.value)} /></label>
}
