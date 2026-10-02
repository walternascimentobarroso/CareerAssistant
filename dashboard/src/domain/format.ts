import type { Rate } from './schema'

export function capitalize(text: string) {
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
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function currencyLabel(code: string) {
  const parts = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0)
  const symbol = parts.find((part) => part.type === 'currency')?.value
  const name = new Intl.DisplayNames('en', { type: 'currency' }).of(code)
  return [code, '—', symbol !== code && symbol, name !== code && name].filter(Boolean).join(' ')
}

export function formatRate(amount: number, rate: Rate) {
  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: rate.currency,
    maximumFractionDigits: 0,
  }).format(amount)
  return `${money}/${rate.period}${rate.vat ? ' + VAT' : ''}`
}
