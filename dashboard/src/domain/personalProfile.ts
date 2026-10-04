import { z } from 'zod'
import { decimalAmount } from './money.ts'
import { isoDate } from './schema.ts'
import { CONTRACT_TYPES, RATE_PERIODS } from './constants.ts'
import type { ApplicationFormValues } from './applicationForm.ts'

export const COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ')
export const LANGUAGE_CODES = 'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' ')
export const AUTHORIZATION_STATES = ['authorized', 'not_authorized', 'unknown'] as const
export const SPONSORSHIP_STATES = ['yes', 'no', 'unknown'] as const
export const NOTICE_TYPES = ['immediate', 'duration', 'negotiable', 'unknown'] as const
export const NOTICE_UNITS = ['days', 'weeks', 'months'] as const
export const REMOTE_PREFERENCES = ['remote_only', 'remote_preferred', 'hybrid', 'onsite', 'flexible'] as const
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native', 'unspecified'] as const
const blank = (v: unknown) => typeof v === 'string' ? v.trim() || null : v
const text = (max: number) => z.preprocess(blank, z.string().max(max).nullable())
const country = z.string().trim().toUpperCase().refine(v => COUNTRY_CODES.includes(v), 'Use an ISO country code')
const url = z.preprocess(blank, z.url().max(2048).refine(v => /^https?:\/\//i.test(v), 'Use HTTP or HTTPS').nullable())
const amount = z.preprocess(blank, decimalAmount.nullable())
export function compareDecimals(a: string, b: string) {
  const units = (v: string) => { const [i, f = ''] = v.split('.'); return BigInt(i + f.padEnd(4, '0')) }
  return units(a) < units(b) ? -1 : units(a) > units(b) ? 1 : 0
}
export const personalProfileSchema = z.strictObject({
  name: text(200), email: z.preprocess(blank, z.email().max(320).nullable()), phone: text(100),
  city: text(200), country: z.preprocess(blank, country.nullable()), linkedin: url, github: url, website: url,
  yearsOfExperience: z.preprocess(blank, z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d)?$/, 'Use a non-negative number with at most one decimal place').nullable()),
  noticeType: z.enum(NOTICE_TYPES), noticeQuantity: z.number().int().positive().max(10000).nullable(), noticeUnit: z.enum(NOTICE_UNITS).nullable(),
  availableFrom: z.preprocess(blank, isoDate.nullable()),
  salaryExpected: amount, salaryMinimum: amount,
  salaryCurrency: z.preprocess(v => typeof v === 'string' ? v.trim().toUpperCase() || null : v, z.string().regex(/^[A-Z]{3}$/).nullable()),
  salaryPeriod: z.enum(RATE_PERIODS).nullable(), salaryVat: z.boolean().nullable(),
  remotePreference: z.enum(REMOTE_PREFERENCES).nullable(),
  workAuthorizations: z.array(z.strictObject({ country, authorization: z.enum(AUTHORIZATION_STATES), sponsorship: z.enum(SPONSORSHIP_STATES), notes: text(2000) })).max(249),
  languages: z.array(z.strictObject({ code: z.string().trim().toLowerCase().refine(v => LANGUAGE_CODES.includes(v), 'Use an ISO language code'), level: z.enum(LANGUAGE_LEVELS) })).max(184),
  contractPreferences: z.array(z.enum(CONTRACT_TYPES)).max(3),
}).superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (v.noticeType === 'duration') {
    if (!v.noticeQuantity) issue('noticeQuantity', 'Specify the notice duration')
    if (!v.noticeUnit) issue('noticeUnit', 'Specify the duration unit')
  } else if (v.noticeQuantity !== null || v.noticeUnit !== null) issue('noticeQuantity', 'Duration applies only to a duration notice period')
  if (v.salaryExpected !== null || v.salaryMinimum !== null) {
    if (!v.salaryExpected) issue('salaryExpected', 'Specify the expected salary')
    if (!v.salaryCurrency) issue('salaryCurrency', 'Specify the currency')
    if (!v.salaryPeriod) issue('salaryPeriod', 'Specify the salary period')
  } else if (v.salaryCurrency !== null || v.salaryPeriod !== null || v.salaryVat !== null) issue('salaryExpected', 'Specify a salary before its currency, period or VAT')
  if (v.salaryExpected && v.salaryMinimum && compareDecimals(v.salaryMinimum, v.salaryExpected) > 0) issue('salaryMinimum', 'Minimum must not exceed expected salary')
  for (const [key, values] of [['workAuthorizations', v.workAuthorizations.map(x => x.country)], ['languages', v.languages.map(x => x.code)], ['contractPreferences', v.contractPreferences]] as const) {
    if (new Set(values).size !== values.length) issue(key, 'Duplicate entries are not allowed')
  }
})
export type PersonalProfileFields = z.infer<typeof personalProfileSchema>
export type PersonalProfile = PersonalProfileFields & { id: string; revision: string }
export const savePersonalProfileSchema = z.strictObject({ ...personalProfileSchema.shape, revision: z.string().regex(/^[1-9]\d*$/).nullable() }).superRefine((v, ctx) => {
  const { revision: _revision, ...fields } = v
  const parsed = personalProfileSchema.safeParse(fields)
  if (!parsed.success) parsed.error.issues.forEach(i => ctx.addIssue({ code: 'custom', path: i.path, message: i.message }))
})
export const emptyPersonalProfile: PersonalProfileFields = {
  name: null, email: null, phone: null, city: null, country: null, linkedin: null, github: null, website: null,
  yearsOfExperience: null, noticeType: 'unknown', noticeQuantity: null, noticeUnit: null, availableFrom: null,
  salaryExpected: null, salaryMinimum: null, salaryCurrency: null, salaryPeriod: null, salaryVat: null, remotePreference: null,
  workAuthorizations: [], languages: [], contractPreferences: [],
}
export function hasSalaryData(form: ApplicationFormValues) {
  return !!(form.rateRequested.trim() || form.rateMinimum.trim() || form.rateCurrency.trim() || form.rateVat || form.rateBasis === 'advertised_range' || form.ratePeriod !== RATE_PERIODS[1])
}
export function applyProfileSalary(form: ApplicationFormValues, profile: PersonalProfileFields): ApplicationFormValues {
  if (!profile.salaryExpected || !profile.salaryCurrency || !profile.salaryPeriod) return form
  return { ...form, rateRequested: profile.salaryExpected, rateMinimum: profile.salaryMinimum ?? '', rateCurrency: profile.salaryCurrency,
    ratePeriod: profile.salaryPeriod, rateVat: profile.salaryVat ?? false, rateBasis: 'personal_expectation' }
}
