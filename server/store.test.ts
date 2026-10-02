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
