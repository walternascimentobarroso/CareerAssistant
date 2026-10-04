import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyPersonalProfile, personalProfileSchema, savePersonalProfileSchema, applyProfileSalary, hasSalaryData } from '../dashboard/src/domain/personalProfile'
import { formFromApplication, fieldsFromForm } from '../dashboard/src/domain/applicationForm'

test('partial profile normalization and unknown eligibility remain explicit', () => {
  const parsed = personalProfileSchema.parse({ ...emptyPersonalProfile, name: '  Ada  ', phone: ' +351 123 456 ', email: ' ', country: 'pt', languages: [{ code: 'EN', level: 'unspecified' }], workAuthorizations: [{ country: 'us', authorization: 'unknown', sponsorship: 'no', notes: ' ' }] })
  assert.equal(parsed.name, 'Ada'); assert.equal(parsed.email, null); assert.equal(parsed.phone, '+351 123 456')
  assert.equal(parsed.country, 'PT'); assert.equal(parsed.languages[0].code, 'en')
  assert.deepEqual(parsed.workAuthorizations[0], { country: 'US', authorization: 'unknown', sponsorship: 'no', notes: null })
  assert.ok(savePersonalProfileSchema.safeParse({ ...emptyPersonalProfile, revision: null }).success)
})
test('profile rejects unsafe URLs, invalid scalars, duplicates and incoherent availability', () => {
  for (const changes of [
    { website: 'javascript:alert(1)' }, { website: 'not a URL' }, { linkedin: 'ftp://example.com' }, { email: 'invalid' }, { country: 'ZZ' },
    { yearsOfExperience: '-1' }, { yearsOfExperience: '1.23' }, { yearsOfExperience: 3 }, { availableFrom: '2026-02-30' },
    { noticeType: 'duration' }, { noticeQuantity: 3 }, { noticeType: 'duration', noticeQuantity: 1.5, noticeUnit: 'days' },
    { languages: [{ code: 'zz', level: 'native' }] }, { languages: [{ code: 'en', level: 'native' }, { code: 'EN', level: 'C1' }] },
    { workAuthorizations: [{ country: 'PT', authorization: 'unknown', sponsorship: 'no', notes: null }, { country: 'pt', authorization: 'authorized', sponsorship: 'yes', notes: null }] },
    { contractPreferences: ['b2b', 'b2b'] }, { unexpected: true },
  ]) assert.equal(personalProfileSchema.safeParse({ ...emptyPersonalProfile, ...changes }).success, false, JSON.stringify(changes))
  assert.ok(personalProfileSchema.safeParse({ ...emptyPersonalProfile, noticeType: 'duration', noticeQuantity: 2, noticeUnit: 'weeks', yearsOfExperience: '0.5' }).success)
})
test('salary validation preserves exact decimals and requires a complete expectation', () => {
  const salary = { ...emptyPersonalProfile, salaryExpected: '900719925474099.1234', salaryMinimum: '900719925474099.1233', salaryCurrency: 'EUR', salaryPeriod: 'year' }
  assert.equal(personalProfileSchema.parse(salary).salaryExpected, salary.salaryExpected)
  for (const changes of [{ salaryMinimum: '900719925474099.1235' }, { salaryCurrency: null }, { salaryPeriod: null }, { salaryExpected: null }, { salaryExpected: 100 }, { salaryExpected: '1.12345' }, { salaryExpected: '0' }]) {
    assert.equal(personalProfileSchema.safeParse({ ...salary, ...changes }).success, false)
  }
})
test('applying profile salary replaces the entire advertised group without copying personal job preferences', () => {
  const profile = personalProfileSchema.parse({ ...emptyPersonalProfile, city: 'Lisbon', remotePreference: 'remote_only', contractPreferences: ['b2b'], salaryExpected: '100.1234', salaryCurrency: 'EUR', salaryPeriod: 'hour' })
  const blank = formFromApplication()
  assert.equal(hasSalaryData(blank), false)
  assert.equal(hasSalaryData({ ...blank, rateCurrency: 'USD' }), true)
  const advertised = { ...blank, location: 'London', type: 'permanent', rateRequested: '90000', rateMinimum: '80000', rateCurrency: 'GBP', ratePeriod: 'year', rateVat: true, rateBasis: 'advertised_range' }
  assert.equal(hasSalaryData(advertised), true)
  const applied = applyProfileSalary(advertised, profile)
  assert.equal(applied.rateRequested, '100.1234'); assert.equal(applied.rateMinimum, ''); assert.equal(applied.rateCurrency, 'EUR')
  assert.equal(applied.ratePeriod, 'hour'); assert.equal(applied.rateVat, false); assert.equal(applied.rateBasis, 'personal_expectation')
  assert.equal(applied.location, 'London'); assert.equal(applied.type, 'permanent'); assert.equal(advertised.rateBasis, 'advertised_range')
  assert.equal((fieldsFromForm(applied).rate as { basis: string }).basis, 'personal_expectation')
  assert.equal(applyProfileSalary(blank, emptyPersonalProfile), blank)
})
