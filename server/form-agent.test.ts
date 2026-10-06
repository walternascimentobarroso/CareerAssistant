import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium, type Browser, type Page } from 'playwright'
import { FormAgent, cvPdf, matchAnswer } from './form-agent.ts'
import { createSession, closeSession, getSession, sessions } from './form-sessions.ts'
import { submitForm } from './form-submitter.ts'
import type { PreparationAnswer } from '../dashboard/src/domain/applicationPreparation.ts'

const answer = (question: string, value: PreparationAnswer['answer']): PreparationAnswer => ({ id: question,
  question, concept: null, type: value?.type ?? 'text', options: [], required: true, answer: value,
  source: 'USER', confidence: 'VERIFIED', evidence: null, reviewReason: null, approval: 'accepted', approvedAt: null })
const browserTests = { skip: !existsSync(chromium.executablePath()) }
test('matching accepts only one explicit approved answer and preserves ambiguity', () => {
  const email = answer('E-mail address', { type: 'text', value: 'ada@example.test' })
  assert.equal(matchAnswer(['e mail address'], [email]), email)
  assert.equal(matchAnswer(['email'], [email]), undefined)
  assert.equal(matchAnswer(['E-mail address'], [email, { ...email, id: 'other' }]), undefined)
  assert.equal(matchAnswer(['E-mail address'], [{ ...email, approval: 'pending' }]), undefined)
})
test('session expiry closes the browser and removes the session', async () => {
  let closed = 0
  const id = createSession({} as Page, { async close() { closed++ } } as unknown as Browser, '', 15)
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(sessions.has(id), false)
  assert.equal(closed, 1)
  assert.throws(() => getSession(id), { status: 404 })
})
test('Chromium fills supported fields, uploads a PDF and waits for explicit submission', browserTests, async () => {
  let submissions = 0
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/sent')) { submissions++; res.setHeader('Content-Type', 'text/html'); res.end('<html><body>Thank you for applying</body></html>'); return }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<html><body><form action="/sent">
      <label>Name<input name="name" required></label><label>Email<input type="email" required></label>
      <label>Phone<input type="tel"></label><label>Website<input type="url"></label>
      <label>Motivation<textarea required></textarea></label>
      <label>Location<select required><option>Remote</option><option>Office</option></select></label>
      <label>Consent<input type="checkbox" required></label>
      <fieldset><legend>Relocation</legend><label>Yes<input type="radio" name="relocation" value="yes" required></label><label>No<input type="radio" name="relocation" value="no"></label></fieldset>
      <label>CV<input type="file" required></label><button type="submit">Submit application</button>
      </form></body></html>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  let id: string | undefined
  try {
    const pdf = await cvPdf('# Ada\n\nExperienced TypeScript engineer.')
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
    const agent = new FormAgent(options => chromium.launch(options), true)
    const inspection = await agent.inspect(`http://127.0.0.1:${address.port}/apply`, [
      answer('Name', { type: 'text', value: 'Ada' }), answer('Email', { type: 'text', value: 'ada@example.test' }),
      answer('Phone', { type: 'text', value: '+351123456789' }), answer('Website', { type: 'text', value: 'https://example.test' }),
      answer('Motivation', { type: 'text', value: 'I build TypeScript services.' }), answer('Location', { type: 'single_select', value: 'Remote' }),
      answer('Consent', { type: 'boolean', value: true }), answer('Relocation', { type: 'boolean', value: false }),
    ], { name: 'cv.pdf', mimeType: 'application/pdf', buffer: pdf })
    id = inspection.sessionId
    assert.equal(inspection.canAutoFill, true)
    assert.ok(inspection.screenshot.length > 100)
    assert.equal(inspection.fields.filter(field => field.filled).length, 9, JSON.stringify(inspection.fields))
    assert.equal(submissions, 0)
    assert.equal(await getSession(id).page.locator('input[name="name"]').inputValue(), 'Ada')
    const concurrent = await Promise.allSettled([submitForm(id), submitForm(id)])
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1)
    assert.equal(submissions, 1)
    await submitForm(id)
    assert.equal(submissions, 1)
    assert.equal(getSession(id).state, 'submitted')
  } finally {
    if (id) await closeSession(id)
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
test('inspection leaves unknown required fields empty and blocks off-domain redirects', browserTests, async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html')
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://localhost:9/apply' }); res.end(); return }
    res.end('<form><label>Unknown<input required></label><button type="submit">Apply</button></form>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const agent = new FormAgent(options => chromium.launch(options), true)
  let id: string | undefined
  try {
    const inspection = await agent.inspect(`http://127.0.0.1:${address.port}/apply`, [])
    id = inspection.sessionId
    assert.equal(inspection.canAutoFill, false)
    assert.equal(inspection.fields[0].filled, false)
    await assert.rejects(submitForm(id), { status: 409 })
    await assert.rejects(agent.inspect(`http://127.0.0.1:${address.port}/redirect`, []), { status: 502 })
  } finally {
    if (id) await closeSession(id)
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
