import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { api } from './api'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Store, StoreError, revision } from './store'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'career-test-'))
  mkdirSync(join(root, 'applications/acme-backend'), { recursive: true })
  mkdirSync(join(root, 'cv'))
  const raw = '---\r\ncompany: Acme # keep this comment\r\nrole: Backend\r\nstatus: interested\r\nnext_action:\r\n  type: apply\r\n  description: Apply now\r\ntimeline:\r\n  - date: 2026-10-01\r\n    type: created\r\n    description: Created\r\n---\r\n\r\n# Notes\r\n  Keep spacing.  \r\n\r\n'
  writeFileSync(join(root, 'applications/acme-backend/application.md'), raw)
  writeFileSync(join(root, 'cv/master.md'), '# Master\nReal experience.\n')
  return { root, raw, store: new Store(root), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
test('status preserves raw notes and comments, appends history and no-op is idempotent', () => {
  const f = fixture()
  try {
    const a = f.store.application('acme-backend')
    const changed = f.store.status(a.slug, { revision: a.revision, status: 'applied', date: '2026-10-02' })
    const saved = f.store.read('applications/acme-backend/application.md')
    assert.equal(saved.split('---\r\n')[2], f.raw.split('---\r\n')[2])
    assert.ok(saved.includes('# keep this comment'))
    assert.equal(changed.data.timeline.length, 2)
    assert.equal(changed.data.timeline[0].description, 'Created')
    assert.equal(changed.data.next_action?.description, 'Apply now')
    f.store.status(a.slug, { revision: changed.revision, status: 'applied', date: '2026-10-02' })
    assert.equal(f.store.read('applications/acme-backend/application.md'), saved)
    assert.throws(() => f.store.status(a.slug, { revision: a.revision, status: 'offer', date: '2026-10-02' }), (e: unknown) => e instanceof StoreError && e.status === 409)
  } finally { f.cleanup() }
})
test('closed statuses remove or retain pending action as selected', () => {
  const f = fixture()
  try {
    let a = f.store.application('acme-backend')
    a = f.store.status(a.slug, { revision: a.revision, status: 'accepted', date: '2026-10-02', keepNextAction: true })
    assert.ok(a.data.next_action)
    a = f.store.status(a.slug, { revision: a.revision, status: 'archived', date: '2026-10-02' })
    assert.equal(a.data.next_action, undefined)
  } finally { f.cleanup() }
})
test('invalid change does not touch files', () => {
  const f = fixture()
  try {
    const a = f.store.application('acme-backend')
    assert.throws(() => f.store.status(a.slug, { revision: a.revision, status: 'applied', date: '2026-02-30' }))
    assert.equal(f.store.read('applications/acme-backend/application.md'), f.raw)
  } finally { f.cleanup() }
})
test('CV copies are independent, reject stale source and protect sent history', () => {
  const f = fixture()
  try {
    let a = f.store.application('acme-backend')
    let source = f.store.cv('master')
    a = f.store.attachCv(a.slug, { name: 'master', revision: a.revision, sourceRevision: source.revision, cvRevision: null })
    const snapshot = a.documents['cv.md']
    f.store.saveCv('master', '# Master\nNew experience.\n', source.revision)
    assert.equal(f.store.application(a.slug).documents['cv.md'], snapshot)
    assert.throws(() => f.store.attachCv(a.slug, { name: 'master', revision: a.revision, sourceRevision: source.revision, cvRevision: revision(snapshot) }))
    source = f.store.cv('master')
    a = f.store.status(a.slug, { revision: a.revision, status: 'applied', date: '2026-10-02' })
    const input = { name: 'master', revision: a.revision, sourceRevision: source.revision, cvRevision: revision(snapshot) }
    assert.throws(() => f.store.attachCv(a.slug, input))
    a = f.store.attachCv(a.slug, { ...input, allowHistoricalEdit: true })
    assert.equal(a.documents['cv.md'], source.content)
    assert.equal(a.data.cv, './cv.md')
  } finally { f.cleanup() }
})
test('paths and symlinks cannot escape root, create cannot overwrite existing CV', () => {
  const f = fixture()
  try {
    assert.throws(() => f.store.cv('../master'))
    assert.throws(() => f.store.path('cv/../../secret'))
    symlinkSync(join(f.root, 'cv/master.md'), join(f.root, 'cv/link.md'))
    assert.throws(() => f.store.cv('link'))
    assert.throws(() => f.store.saveCv('master', 'Overwrite', null))
    const cv = f.store.saveCv('backend', '# Backend', null)
    assert.equal(readFileSync(join(f.root, 'cv/backend.md'), 'utf8'), cv.content)
    assert.throws(() => f.store.saveCv('backend', '# Updated', revision('old')))
  } finally { f.cleanup() }
})

async function callApi(store: Store, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as IncomingMessage
  req.method = method; req.url = url; req.headers = { host: 'localhost:5173', 'content-type': 'application/json', ...headers }
  let status = 0; let result = ''
  const res = { writeHead(code: number) { status = code }, end(value: string) { result = value } } as unknown as ServerResponse
  await api(store)(req, res)
  return { status, value: JSON.parse(result) }
}
test('API validates requests, persists status, and rejects stale or cross-origin mutations', async () => {
  const f = fixture()
  try {
    const list = await callApi(f.store, 'GET', '/api/applications')
    assert.equal(list.status, 200)
    const a = list.value.applications[0]
    assert.equal((await callApi(f.store, 'PATCH', `/api/applications/${a.slug}/status`, { revision: a.revision, status: 'applied', date: '2026-02-30' })).status, 422)
    assert.equal((await callApi(f.store, 'PATCH', `/api/applications/${a.slug}/status`, { revision: a.revision, status: 'applied', date: '2026-10-02' })).status, 200)
    assert.equal((await callApi(f.store, 'PATCH', `/api/applications/${a.slug}/status`, { revision: a.revision, status: 'offer', date: '2026-10-02' })).status, 409)
    assert.equal((await callApi(f.store, 'POST', '/api/cvs', { name: 'evil', content: 'text' }, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await callApi(f.store, 'POST', '/api/cvs', { name: 'evil', content: 'text' }, { host: 'evil.example' })).status, 403)
    assert.equal((await callApi(f.store, 'POST', '/api/cvs', { name: '../escape', content: 'text' })).status, 400)
    assert.equal((await callApi(f.store, 'POST', '/api/cvs', { name: 'backend', content: '# CV' })).status, 201)
    assert.equal((await callApi(f.store, 'POST', '/api/cvs', { name: 'backend', content: '# Overwrite' })).status, 409)
  } finally { f.cleanup() }
})
test('empty and flow timelines remain valid when appending events', () => {
  const f = fixture()
  try {
    for (const timeline of ['', 'timeline: []\n', 'timeline: [{date: 2026-10-01, type: created, description: Created}]\n']) {
      const raw = `---\ncompany: Acme\nrole: Backend\nstatus: interested # keep inline comment\n${timeline}---\nBody\n`
      writeFileSync(join(f.root, 'applications/acme-backend/application.md'), raw)
      const a = f.store.application('acme-backend')
      const changed = f.store.status(a.slug, { revision: a.revision, status: 'applied', date: '2026-10-02' })
      assert.equal(changed.data.timeline.at(-1)?.type, 'status_changed')
      assert.ok(f.store.read('applications/acme-backend/application.md').includes('# keep inline comment'))
    }
  } finally { f.cleanup() }
})
test('create builds a valid application with job description and refuses duplicates', () => {
  const f = fixture()
  try {
    const input = { fields: { company: 'Açme Inc.', role: 'Senior Dev', job_url: 'https://example.com/job', location: null, tags: ['php'] }, applied: true, date: '2026-10-02', jobPosting: 'We need a dev.\n\n## About us\nNice.' }
    const a = f.store.createApplication(input)
    assert.equal(a.slug, 'acme-inc-senior-dev')
    assert.equal(a.data.status, 'applied')
    assert.equal(a.data.applied_at, '2026-10-02')
    assert.equal(a.data.timeline[0].type, 'applied')
    assert.equal(a.data.location, undefined)
    assert.ok(a.documents['job-description.md'].includes('Source: https://example.com/job'))
    assert.ok(a.documents['job-description.md'].includes('## About us'))
    assert.throws(() => f.store.createApplication(input), (e: unknown) => e instanceof StoreError && e.status === 409)
    assert.throws(() => f.store.createApplication({ fields: { company: 'Solo' }, applied: false, date: '2026-10-02' }))
    assert.equal(f.store.applications().applications.length, 2)
    assert.equal(f.store.createApplication({ fields: { company: 'Beta', role: 'Dev' }, applied: false, date: '2026-10-02' }).data.timeline[0].type, 'created')
  } finally { f.cleanup() }
})
test('update edits only changed fields as block YAML, appends events and rejects stale or invalid edits', () => {
  const f = fixture()
  try {
    const raw = '---\ncompany: Acme # keep this comment\nrole: Backend\nstatus: interested\nlocation: Remote\nrate:\n  currency: EUR\n  requested: 250\n  period: day\n\n# keep block comment\nnext_action:\n  type: apply\n  description: Apply now\ntags: [php]\ntimeline:\n  - date: 2026-10-01\n    type: created\n    description: Created\n---\n\n# Notes\n  Keep spacing.  \n'
    writeFileSync(join(f.root, 'applications/acme-backend/application.md'), raw)
    const a = f.store.application('acme-backend')
    const unchanged = { company: 'Acme', role: 'Backend', location: 'Remote', rate: { requested: 250, currency: 'EUR', period: 'day' }, tags: ['php'] }
    assert.equal(f.store.updateApplication(a.slug, { revision: a.revision, fields: unchanged }).revision, a.revision)
    const changed = f.store.updateApplication(a.slug, {
      revision: a.revision,
      fields: { ...unchanged, location: null, rate: { requested: 300, currency: 'EUR', period: 'day' }, contact: { name: 'Ana' }, tags: ['php', 'symfony'] },
      event: { date: '2026-10-02', type: 'contact', description: 'Recruiter called' },
    })
    const saved = f.store.read('applications/acme-backend/application.md')
    assert.equal(saved.split('---\n')[2], raw.split('---\n')[2])
    assert.ok(saved.includes('# keep this comment') && saved.includes('# keep block comment'))
    assert.ok(saved.includes('rate:\n  requested: 300\n  currency: EUR\n  period: day\n'))
    assert.ok(saved.includes('contact:\n  name: Ana'))
    assert.ok(!saved.includes('{') && !saved.includes('location'))
    assert.deepEqual(changed.data.tags, ['php', 'symfony'])
    assert.equal(changed.data.next_action?.description, 'Apply now')
    assert.deepEqual(changed.data.timeline.map(e => e.type), ['created', 'contact'])
    assert.throws(() => f.store.updateApplication(a.slug, { revision: a.revision, fields: { role: 'Stale' } }), (e: unknown) => e instanceof StoreError && e.status === 409)
    assert.throws(() => f.store.updateApplication(a.slug, { revision: changed.revision, fields: { company: null } }))
    assert.throws(() => f.store.updateApplication(a.slug, { revision: changed.revision, fields: { rate: { requested: 300 } } }))
    assert.equal(f.store.read('applications/acme-backend/application.md'), saved)
  } finally { f.cleanup() }
})
test('moving to applied fills applied_at once, notes are append-only, job description needs its revision', () => {
  const f = fixture()
  try {
    let a = f.store.application('acme-backend')
    a = f.store.status(a.slug, { revision: a.revision, status: 'applied', date: '2026-10-02' })
    assert.equal(a.data.applied_at, '2026-10-02')
    a = f.store.status(a.slug, { revision: a.revision, status: 'interested', date: '2026-10-03' })
    a = f.store.status(a.slug, { revision: a.revision, status: 'applied', date: '2026-10-04' })
    assert.equal(a.data.applied_at, '2026-10-02')
    const before = f.store.read('applications/acme-backend/application.md')
    assert.throws(() => f.store.appendNote(a.slug, { revision: revision('old'), note: 'Lost' }), (e: unknown) => e instanceof StoreError && e.status === 409)
    a = f.store.appendNote(a.slug, { revision: a.revision, note: 'Called back.\nSecond line.' })
    assert.equal(f.store.read('applications/acme-backend/application.md'), before + 'Called back.\r\nSecond line.\r\n')
    a = f.store.saveJobDescription(a.slug, { content: '# Job Description\n', revision: null })
    assert.throws(() => f.store.saveJobDescription(a.slug, { content: 'Overwrite', revision: null }), (e: unknown) => e instanceof StoreError && e.status === 409)
    a = f.store.saveJobDescription(a.slug, { content: '# Job Description\n\nUpdated\n', revision: revision(a.documents['job-description.md']) })
    assert.ok(a.documents['job-description.md'].includes('Updated'))
  } finally { f.cleanup() }
})
test('API creates, edits and annotates applications with validation', async () => {
  const f = fixture()
  try {
    assert.equal((await callApi(f.store, 'POST', '/api/applications', { fields: { company: 'Beta', role: 'Dev', status: 'offer' }, applied: false, date: '2026-10-02' })).status, 422)
    assert.equal((await callApi(f.store, 'POST', '/api/applications', { fields: { company: 'Beta', role: 'Dev', rate: { requested: 1 } }, applied: false, date: '2026-10-02' })).status, 422)
    const created = await callApi(f.store, 'POST', '/api/applications', { fields: { company: 'Beta', role: 'Dev' }, applied: false, date: '2026-10-02' })
    assert.equal(created.status, 201)
    const { slug, revision: current } = created.value
    assert.equal((await callApi(f.store, 'PATCH', `/api/applications/${slug}`, { revision: current, fields: { priority: 'urgent' } })).status, 422)
    const edited = await callApi(f.store, 'PATCH', `/api/applications/${slug}`, { revision: current, fields: { priority: 'high' } })
    assert.equal(edited.value.data.priority, 'high')
    assert.equal((await callApi(f.store, 'POST', `/api/applications/${slug}/notes`, { revision: edited.value.revision, note: '  ' })).status, 422)
    const noted = await callApi(f.store, 'POST', `/api/applications/${slug}/notes`, { revision: edited.value.revision, note: 'Remember this' })
    assert.ok(noted.value.notes.endsWith('Remember this'))
    assert.equal((await callApi(f.store, 'PUT', `/api/applications/${slug}/job-description`, { content: '# Job Description\n', revision: null })).status, 200)
  } finally { f.cleanup() }
})
