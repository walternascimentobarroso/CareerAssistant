import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { api } from './api.ts'
import type { PostgresStore } from './postgres-store.ts'
import { StoreError } from './store.ts'
import { fieldsFromForm, formFromApplication, formFromSuggestion } from '../dashboard/src/domain/applicationForm.ts'
import { suggestionSchema } from '../dashboard/src/domain/suggestion.ts'

test('application forms preserve the detected apply URL through loading and serialization', () => {
  const form = formFromSuggestion(suggestionSchema.parse({ company: 'Acme', role: 'Engineer', apply_url: 'https://company.test/apply' }))
  assert.equal(form.apply_url, 'https://company.test/apply')
  assert.equal(fieldsFromForm(form).apply_url, 'https://company.test/apply')
  const loaded = formFromApplication({ company: 'Acme', role: 'Engineer', status: 'interested', apply_url: form.apply_url, tags: [], timeline: [] })
  assert.equal(loaded.apply_url, form.apply_url)
  assert.equal(fieldsFromForm({ ...loaded, apply_url: null }).apply_url, null)
  assert.equal(fieldsFromForm({ ...loaded, apply_url: '  ' }).apply_url, null)
  assert.equal(fieldsFromForm({ ...loaded, apply_url: undefined }).apply_url, null)
})
test('manual submission API validates dates and UUIDs and propagates stale revisions', async () => {
  let calls = 0
  const store = { async recordSubmission(slug: string, input: { revision: string }) {
    assert.equal(slug, 'acme')
    if (input.revision === '1') throw new StoreError(409, 'Stale revision')
    calls++
    return { revision: '3', data: { status: 'applied' } }
  } } as unknown as PostgresStore
  async function request(body: unknown) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage
    req.method = 'POST'; req.url = '/api/applications/acme/record-submission'
    req.headers = { host: 'localhost', 'content-type': 'application/json' }
    let status = 0, value = ''
    const res = { writeHead(code: number) { status = code }, end(text: string) { value = text } } as unknown as ServerResponse
    await api(store)(req, res)
    return { status, value: JSON.parse(value) }
  }
  assert.equal((await request({ date: '2026-02-30', revision: '2' })).status, 422)
  assert.equal((await request({ date: '2026-10-06', revision: '2', cvVersionId: 'invalid' })).status, 422)
  assert.equal((await request({ date: '2026-10-06' })).status, 422)
  assert.equal((await request({ date: '2026-10-06', revision: '1' })).status, 409)
  assert.equal((await request({ date: '2026-10-06', revision: '2', channel: 'email', cvVersionId: '10000000-0000-4000-8000-000000000001' })).status, 200)
  assert.equal((await request({ date: '2026-10-06', revision: '2' })).status, 200)
  assert.equal(calls, 2)
})
