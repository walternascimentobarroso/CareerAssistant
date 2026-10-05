import { RATE_PERIODS } from '../domain/constants'
import type { AnswerType, AnswerValue } from '../domain/knowledge'

type Props = { type: AnswerType; options: string[]; value: AnswerValue | null; onChange: (value: AnswerValue | null) => void }

/** Emits the draft as typed; the shared schema validates it on save. */
export function AnswerInput({ type, options, value, onChange }: Props) {
  if (type === 'boolean') {
    const selected = value?.type === 'boolean' ? String(value.value) : ''
    return <label>Answer<select value={selected} onChange={e => onChange(e.target.value === '' ? null : { type, value: e.target.value === 'true' })}>
      <option value="">Not set</option><option value="true">Yes</option><option value="false">No</option>
    </select></label>
  }
  if (type === 'money') {
    const money = value?.type === 'money' ? value : { type, amount: '', currency: '', period: RATE_PERIODS[3] }
    const set = (changes: Partial<typeof money>) => { const next = { ...money, ...changes }; onChange(next.amount || next.currency ? next : null) }
    return <div className="form-grid">
      <label>Amount<input value={money.amount} onChange={e => set({ amount: e.target.value.trim() })} /></label>
      <label>Currency (e.g. EUR)<input value={money.currency} onChange={e => set({ currency: e.target.value.trim().toUpperCase() })} /></label>
      <label>Period<select value={money.period} onChange={e => set({ period: e.target.value as typeof money.period })}>{RATE_PERIODS.map(period => <option key={period}>{period}</option>)}</select></label>
    </div>
  }
  if (type === 'multi_select') {
    const selected = value?.type === 'multi_select' ? value.value : []
    const set = (next: string[]) => onChange(next.length ? { type, value: next } : null)
    if (!options.length) return <label>Answers (comma separated)<input value={selected.join(', ')} onChange={e => set(e.target.value.split(',').map(item => item.trimStart()).filter((item, index, all) => item || index === all.length - 1))} /></label>
    return <fieldset><legend>Answer</legend>{options.map(option => <label key={option}>
      <input type="checkbox" checked={selected.includes(option)} onChange={e => set(e.target.checked ? [...selected, option] : selected.filter(item => item !== option))} />{option}
    </label>)}</fieldset>
  }
  const text = value && value.type === type && typeof value.value === 'string' ? value.value : ''
  const set = (next: string) => onChange(next ? { type, value: next } : null)
  if (type === 'single_select' && options.length) return <label>Answer<select value={text} onChange={e => set(e.target.value)}>
    <option value="">Not set</option>{options.map(option => <option key={option}>{option}</option>)}
  </select></label>
  if (type === 'text') return <label>Answer<textarea rows={4} value={text} onChange={e => set(e.target.value)} /></label>
  return <label>Answer<input value={text} onChange={e => set(e.target.value)} /></label>
}
