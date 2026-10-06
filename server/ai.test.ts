import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Ai } from './ai.ts'
import { api } from './api.ts'
import type { PostgresStore } from './postgres-store.ts'

const config = { read: () => 'GROQ_API_KEY=test\nGEMINI_API_KEY=test\n', write: () => '' }
function completion(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}
test('extraction includes the explicit application URL and tolerates an absent URL', async () => {
  let prompt = ''
  const ai = new Ai(config, (async (_url, init) => {
    prompt = JSON.parse(String(init?.body)).messages[0].content
    return completion(JSON.stringify({ company: 'Acme', apply_url: 'https://acme.test/apply' }))
  }) as typeof fetch)
  assert.equal((await ai.extract({ text: 'Apply: https://acme.test/apply' })).suggestion.apply_url, 'https://acme.test/apply')
  assert.match(prompt, /apply_url/)
  const absent = new Ai(config, (async () => completion('{"apply_url":null}')) as typeof fetch)
  assert.equal((await absent.extract({ text: 'No application link' })).suggestion.apply_url, undefined)
})
test('CV adaptation sends source facts and profile, selects the provider and returns only Markdown', async () => {
  const ai = new Ai(config, (async (url, init) => {
    assert.match(String(url), /generativelanguage/)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'chosen-model')
    assert.equal(body.response_format, undefined)
    assert.match(body.messages[0].content, /NEVER invent/)
    assert.deepEqual(JSON.parse(body.messages[1].content), { cvContent: '# Base CV', jobDescription: 'TypeScript developer', role: 'Engineer', company: 'Acme', profile: null })
    return completion('```markdown\n# Adapted CV\n```')
  }) as typeof fetch)
  assert.equal(await ai.adaptCv({ cvContent: '# Base CV', jobDescription: 'TypeScript developer', role: 'Engineer', company: 'Acme', provider: 'gemini', model: 'chosen-model' }), '# Adapted CV')
})
test('empty AI output and provider failure reject the adaptation', async () => {
  const input = { cvContent: '# CV', jobDescription: 'Job', role: 'Engineer', company: 'Acme' }
  const empty = new Ai(config, (async () => completion(' ')) as typeof fetch)
  await assert.rejects(empty.adaptCv(input), { status: 502 })
  const failed = new Ai(config, (async () => new Response('{"error":{"message":"Unavailable"}}', { status: 503 })) as typeof fetch)
  await assert.rejects(failed.adaptCv(input), { status: 502 })
})
test('adapt-cv route validates the request and persists only a successful AI result', async () => {
  const versionId = '10000000-0000-4000-8000-000000000001'
  const context = { cvContent: '# CV', jobDescription: 'Job', role: 'Engineer', company: 'Acme', profile: null }
  let saves = 0
  const store = { ...config,
    async adaptationContext(slug: string, version: string) { assert.equal(slug, 'acme'); assert.equal(version, versionId); return context },
    async saveAdaptedPreparationCv(snapshot: unknown, content: string) { assert.equal(snapshot, context); saves++; return { versionId, content } },
  } as unknown as PostgresStore
  async function request(body: unknown, output: string) {
    const req = Readable.from([JSON.stringify(body)]) as IncomingMessage
    req.method = 'POST'; req.url = '/api/applications/acme/preparation/adapt-cv'
    req.headers = { host: 'localhost', 'content-type': 'application/json' }
    let status = 0, value = ''
    const res = { writeHead(code: number) { status = code }, end(text: string) { value = text } } as unknown as ServerResponse
    await api(store, (async () => completion(output)) as typeof fetch)(req, res)
    return { status, value: JSON.parse(value) }
  }
  assert.equal((await request({ cvVersionId: 'invalid' }, '# Adapted')).status, 422)
  assert.equal(saves, 0)
  assert.equal((await request({ cvVersionId: versionId }, '')).status, 502)
  assert.equal(saves, 0)
  assert.deepEqual(await request({ cvVersionId: versionId }, '# Adapted'), { status: 200, value: { versionId, content: '# Adapted' } })
  assert.equal(saves, 1)
})
