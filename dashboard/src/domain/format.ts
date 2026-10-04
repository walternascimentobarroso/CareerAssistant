import type { Rate } from './schema.ts'
import { displayMoney } from './money.ts'

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function humanize(identifier: string) {
  return capitalize(identifier.replaceAll('_', ' '))
}

export function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

export function todayIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: personalTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function currencyLabel(code: string) {
  const parts = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0)
  const symbol = parts.find((part) => part.type === 'currency')?.value
  const name = new Intl.DisplayNames('en', { type: 'currency' }).of(code)
  return [code, '—', symbol !== code && symbol, name !== code && name].filter(Boolean).join(' ')
}

export function formatRate(amount: string, rate: Rate) {
  return `${displayMoney(amount, rate.currency)}/${rate.period}${rate.vat ? ' + VAT' : ''}`
}

let personalTimezone = 'Europe/Lisbon'
export function setPersonalTimezone(value: string) { new Intl.DateTimeFormat('en', { timeZone:value }); personalTimezone=value }
