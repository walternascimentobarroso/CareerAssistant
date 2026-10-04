import { z } from 'zod'

// NUMERIC(19,4): at most 15 integer digits and 4 fractional digits. No rounding.
export const decimalAmount = z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/, 'Use a positive decimal with at most 4 decimal places')
  .refine(value => /[1-9]/.test(value), 'Amount must be positive')

export function legacyDecimal(value: unknown): unknown {
  if (typeof value !== 'number') return value
  if (!Number.isFinite(value)) return value
  // Legacy YAML numbers have already been parsed. Keep the raw source separately during import.
  return String(value)
}
export function displayMoney(value: string, currency: string) {
  const [integer, fraction = ''] = value.split('.')
  const formatted = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(BigInt(integer))
  const significant = fraction.replace(/0+$/, '')
  if (!significant) return formatted
  const separator = new Intl.NumberFormat('en').formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.'
  return formatted.replace(/\d(?=\D*$)/, digit => digit + separator + significant)
}
