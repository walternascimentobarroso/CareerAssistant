import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Browser, Page } from 'playwright'
import { api } from './api.ts'
import type { PostgresStore } from './postgres-store.ts'
import { createSession, getSession, closeSession, sessions } from './form-sessions.ts'
import type { FormAgent } from './form-agent.ts'
import { StoreError } from './store.ts'

async function request(handler: ReturnType<typeof api>, action: string, body: unknown, slug = 'acme') {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage
  req.method = 'POST'; req.url = `/api/applications/${slug}/preparation/${action}`
  req.headers = { host: 'localhost', 'content-type': 'application/json' }
  let status = 0, value = ''
  const res = { writeHead(code: number) { status = code }, end(text: string) { value = text } } as unknown as ServerResponse
  await handler(req, res)
  return { status, value: JSON.parse(value) }
}
const snapshot = { applicationId: 'app', applicationRevision: '1', preparationId: 'prep', preparationRevision: '1',
  jobId: 'job', jobRevision: '1', applyUrl: 'https://company.test/apply', cvVersionId: null }
test('form API returns inspection, binds ownership, records submission and cleans the session', async () => {
  let id = '', closed = 0, recorded = 0
  const store = {
    async formContext() { return { snapshot, answers: [], cvContent: '# CV' } },
    async markFormInspected(value: unknown, inspected: boolean) { assert.equal(value, snapshot); assert.equal(inspected, true); return { ...snapshot, preparationRevision: '2' } },
    async recordFormSubmission(slug: string, value: unknown, session: string, submit: () => Promise<void>) {
      if (slug !== 'acme') throw new StoreError(409, 'Wrong owner')
      assert.equal((value as typeof snapshot).preparationRevision, '2'); assert.equal(session, id)
      await submit(); recorded++
    },
  } as unknown as PostgresStore
  const agent = { async inspect(url: string, _answers: unknown, pdf: unknown) {
    assert.equal(url, snapshot.applyUrl)
    assert.deepEqual(pdf, { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') })
    id = createSession({} as Page, { async close() { closed++ } } as unknown as Browser, 'form')
    return { sessionId: id, fields: [{ selector: '#email', label: 'Email', type: 'email', required: true, filled: true }], screenshot: 'base64', canAutoFill: true }
  } } as Pick<FormAgent, 'inspect'>
  const handler = api(store, fetch, undefined, agent, async () => Buffer.from('pdf'))
  try {
    const inspected = await request(handler, 'inspect-form', {})
    assert.equal(inspected.status, 200)
    assert.equal(inspected.value.sessionId, id)
    assert.equal((await request(handler, 'submit-form', { sessionId: id }, 'other')).status, 409)
    assert.equal(recorded, 0)
    getSession(id).state = 'submitted' // External confirmation is tested against Chromium in form-agent.test.ts.
    assert.deepEqual(await request(handler, 'submit-form', { sessionId: id }), { status: 200, value: { ok: true } })
    assert.equal(recorded, 1); assert.equal(closed, 1); assert.equal(sessions.has(id), false)
    assert.equal((await request(handler, 'submit-form', { sessionId: id })).status, 404)
  } finally { if (id) await closeSession(id) }
})
test('form API rejects malformed input and closes a session if inspection persistence fails', async () => {
  let id = '', closed = 0
  const store = {
    async formContext() { return { snapshot, answers: [], cvContent: null } },
    async markFormInspected() { throw new StoreError(409, 'Preparation changed') },
  } as unknown as PostgresStore
  const agent = { async inspect() {
    id = createSession({} as Page, { async close() { closed++ } } as unknown as Browser, 'form')
    return { sessionId: id, fields: [], screenshot: '', canAutoFill: false }
  } } as Pick<FormAgent, 'inspect'>
  const handler = api(store, fetch, undefined, agent)
  assert.equal((await request(handler, 'submit-form', { sessionId: 'invalid' })).status, 422)
  assert.equal((await request(handler, 'inspect-form', { unexpected: true })).status, 422)
  assert.equal((await request(handler, 'inspect-form', {})).status, 409)
  assert.equal(closed, 1); assert.equal(sessions.has(id), false)
})


test('cancel-form validates ownership, closes the browser and removes its session', async () => {
  let closed = 0
  const id = createSession({} as Page, { async close() { closed++ } } as unknown as Browser, 'form')
  getSession(id).snapshot = snapshot
  const store = { async assertFormSessionOwner(slug: string, applicationId: string) {
    assert.equal(applicationId, snapshot.applicationId)
    if (slug !== 'acme') throw new StoreError(409, 'Wrong owner')
  } } as unknown as PostgresStore
  const handler = api(store)
  try {
    assert.equal((await request(handler, 'cancel-form', { sessionId: 'invalid' })).status, 422)
    assert.equal((await request(handler, 'cancel-form', { sessionId: id }, 'other')).status, 409)
    assert.equal(closed, 0)
    getSession(id).state = 'submitting'
    assert.equal((await request(handler, 'cancel-form', { sessionId: id })).status, 409)
    getSession(id).state = 'inspected'
    assert.deepEqual(await request(handler, 'cancel-form', { sessionId: id }), { status: 200, value: { ok: true } })
    assert.equal(closed, 1)
    assert.equal(sessions.has(id), false)
    assert.equal((await request(handler, 'cancel-form', { sessionId: id })).status, 404)
  } finally { await closeSession(id) }
})
test('PATCH jobs accepts an apply_url string or null and rejects other bodies', async () => {
  const saved: unknown[] = []
  const store = { async saveJobApplyUrl(slug: string, value: string | null) { assert.equal(slug, 'acme'); saved.push(value); return { apply_url: value } } } as unknown as PostgresStore
  const handler = api(store)
  async function patch(body: unknown) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage
    req.method = 'PATCH'; req.url = '/api/jobs/acme'; req.headers = { host: 'localhost', 'content-type': 'application/json' }
    let status = 0, value = ''
    const res = { writeHead(code: number) { status = code }, end(text: string) { value = text } } as unknown as ServerResponse
    await handler(req, res)
    return { status, value: JSON.parse(value) }
  }
  assert.deepEqual(await patch({ apply_url: 'https://company.test/apply' }), { status: 200, value: { apply_url: 'https://company.test/apply' } })
  assert.deepEqual(await patch({ apply_url: null }), { status: 200, value: { apply_url: null } })
  assert.equal((await patch({ apply_url: 3 })).status, 422)
  assert.equal((await patch({})).status, 422)
  assert.deepEqual(saved, ['https://company.test/apply', null])
})
