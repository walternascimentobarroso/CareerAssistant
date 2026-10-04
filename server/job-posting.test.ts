import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { api } from './api'
import { createJobPostingFetcher, isPublicAddress, nodeTransport, type Resolver, type Transport } from './job-posting-fetcher'
import { extractJobPosting } from './job-posting-text'
import type { PostgresStore } from './postgres-store'
import { emptyJobDescription, parseJobDescription, serializeJobDescription } from '../dashboard/src/domain/jobDescription'

const DESCRIPTION = 'We are hiring a backend engineer to build payment services. '.repeat(5).trim()
const page = (body: string, head = '') => `<!doctype html><html><head><title>Job</title>${head}</head><body>${body}</body></html>`
const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`
const posting = (title: string, description = `<p>${DESCRIPTION}</p><ul><li>Node.js &amp; SQL</li><li>Remote</li></ul>`) => ({ '@type': 'JobPosting', title, description })
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected

test('JSON-LD JobPosting is preferred, alone, in an array or inside @graph', () => {
  for (const value of [posting('Senior Engineer'), [{ '@type': 'Organization' }, posting('Senior Engineer')], { '@graph': [posting('Senior Engineer')] }]) {
    const { text, method } = extractJobPosting(page('<main><p>Cookie banner</p></main>', jsonLd(value)), 'html')
    assert.equal(method, 'json_ld')
    assert.equal(text, `Senior Engineer\n\n${DESCRIPTION}\n\n- Node.js & SQL\n- Remote`)
  }
})
test('escaped JSON-LD markup is decoded, invalid JSON is ignored and several postings are refused', () => {
  const escaped = extractJobPosting(page('', jsonLd(posting('Engineer', `&lt;p&gt;${DESCRIPTION}&lt;/p&gt;`))), 'html')
  assert.equal(escaped.text, `Engineer\n\n${DESCRIPTION}`)
  const fallback = extractJobPosting(page(`<main><h1>Engineer</h1><p>${DESCRIPTION}</p></main>`, '<script type="application/ld+json">{not json</script>'), 'html')
  assert.equal(fallback.method, 'html')
  assert.throws(() => extractJobPosting(page('', jsonLd([posting('One'), posting('Two')])), 'html'), code('NO_JOB_CONTENT'))
})
test('HTML fallback keeps blocks and lists and drops scripts, navigation, footers and forms', () => {
  const html = page(`<nav>Home Jobs</nav><main><h1>Backend&nbsp;Engineer</h1><div class="job-description"><p>${DESCRIPTION}</p><ul><li>Caf&eacute; budget</li></ul>
    <script>alert(1)</script></div><form><input value="apply"></form></main><footer>Imprint</footer>`)
  const { text, method } = extractJobPosting(html, 'html')
  assert.equal(method, 'html')
  assert.equal(text, `${DESCRIPTION}\n\n- Café budget`)
})
test('empty, login and human-check pages are refused even when long enough', () => {
  assert.throws(() => extractJobPosting(page('<main><p>Loading…</p></main>'), 'html'), code('NO_JOB_CONTENT'))
  const filler = 'This content is available to members of our talent community only. '.repeat(4)
  assert.throws(() => extractJobPosting(page(`<main><p>Please sign in to continue. ${filler}</p></main>`), 'html'), code('NO_JOB_CONTENT'))
  assert.throws(() => extractJobPosting(page(`<main><p>Complete the CAPTCHA below. ${filler}</p></main>`), 'html'), code('NO_JOB_CONTENT'))
})

test('only global addresses are public', () => {
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) assert.equal(isPublicAddress({ address, family: 4 }), false, address)
  for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress({ address, family: 6 }), false, address)
  assert.equal(isPublicAddress({ address: '93.184.216.34', family: 4 }), true)
  assert.equal(isPublicAddress({ address: '2606:4700::6810:1', family: 6 }), true)
})

const PUBLIC = [{ address: '93.184.216.34', family: 4 }]
const html = (body = page(`<main><p>${DESCRIPTION}</p></main>`)) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Readable.from([Buffer.from(body)]) })
function fetcher(routes: Record<string, () => Awaited<ReturnType<Transport>> | Promise<Awaited<ReturnType<Transport>>>>, hosts: Record<string, { address: string; family: number }[]> = {}) {
  const connections: string[] = []
  const resolve: Resolver = async hostname => hosts[hostname] ?? PUBLIC
  const transport: Transport = async ({ url, address }) => {
    connections.push(`${url.href} via ${address}`)
    const route = routes[url.href]
    if (!route) throw new Error(`unexpected ${url.href}`)
    return route()
  }
  return { connections, fetch: createJobPostingFetcher({ resolve, transport, now: () => new Date('2026-10-04T10:40:00.000Z'), timeoutMs: 200 }) }
}

test('a successful import returns reviewed-ready text and provenance, without the fragment', async () => {
  const { fetch, connections } = fetcher({ 'https://example.com/jobs/1?id=7': () => html() })
  assert.deepEqual(await fetch('https://example.com/jobs/1?id=7#apply'), { text: DESCRIPTION, requestedUrl: 'https://example.com/jobs/1?id=7', resolvedUrl: 'https://example.com/jobs/1?id=7', capturedAt: '2026-10-04T10:40:00.000Z', method: 'html' })
  assert.deepEqual(connections, ['https://example.com/jobs/1?id=7 via 93.184.216.34'])
})
test('invalid links are rejected before any lookup', async () => {
  const { fetch, connections } = fetcher({})
  for (const url of ['ftp://example.com/job', 'file:///etc/passwd', 'not a url', 'https://user:secret@example.com/job', 'https://example.com:8443/job', `https://example.com/${'a'.repeat(4100)}`]) await assert.rejects(fetch(url), code('INVALID_URL'), url)
  assert.deepEqual(connections, [])
})
test('private destinations are blocked as literals, through DNS and when only one answer is private', async () => {
  const { fetch, connections } = fetcher({}, { 'intranet.example': [{ address: '10.0.0.5', family: 4 }], 'mixed.example': [...PUBLIC, { address: '::1', family: 6 }] })
  for (const url of ['http://127.0.0.1/job', 'http://2130706433/job', 'http://[::1]/job', 'http://[::ffff:127.0.0.1]/job', 'http://169.254.169.254/latest/meta-data', 'https://intranet.example/job', 'https://mixed.example/job']) await assert.rejects(fetch(url), code('BLOCKED_DESTINATION'), url)
  assert.deepEqual(connections, [])
})
test('redirects are followed manually and revalidated at every hop', async () => {
  const redirect = (location: string) => () => ({ status: 302, headers: { location }, body: Readable.from([]) })
  const followed = fetcher({ 'https://example.com/a': redirect('/b'), 'https://example.com/b': redirect('https://careers.example.com/job#top'), 'https://careers.example.com/job': () => html() })
  assert.equal((await followed.fetch('https://example.com/a')).resolvedUrl, 'https://careers.example.com/job')
  const toPrivate = fetcher({ 'https://example.com/a': redirect('https://intranet.example/admin') }, { 'intranet.example': [{ address: '192.168.1.10', family: 4 }] })
  await assert.rejects(toPrivate.fetch('https://example.com/a'), code('BLOCKED_DESTINATION'))
  assert.equal(toPrivate.connections.length, 1)
  await assert.rejects(fetcher({ 'https://example.com/a': redirect('http://example.com/a') }).fetch('https://example.com/a'), code('BLOCKED_DESTINATION'))
  await assert.rejects(fetcher({ 'https://example.com/a': redirect('https://example.com:8080/a') }).fetch('https://example.com/a'), code('BLOCKED_DESTINATION'))
  const loop = fetcher({ 'https://example.com/a': redirect('/a') })
  await assert.rejects(loop.fetch('https://example.com/a'), code('REMOTE_UNAVAILABLE'))
  assert.equal(loop.connections.length, 6)
})
test('timeouts, oversized bodies, other content and remote failures have stable codes', async () => {
  const never = fetcher({ 'https://example.com/slow': () => new Promise(() => {}) })
  await assert.rejects(never.fetch('https://example.com/slow'), (error: { status?: number; code?: string }) => error.code === 'FETCH_TIMEOUT' && error.status === 504)
  // No Content-Length: the limit applies to what is actually read.
  const chunk = Buffer.alloc(512 * 1024, 'a')
  const large = fetcher({ 'https://example.com/large': () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Readable.from([chunk, chunk, chunk, chunk, chunk]) }) })
  await assert.rejects(large.fetch('https://example.com/large'), (error: { status?: number; code?: string }) => error.code === 'RESPONSE_TOO_LARGE' && error.status === 413)
  const pdf = fetcher({ 'https://example.com/job.pdf': () => ({ status: 200, headers: { 'content-type': 'application/pdf' }, body: Readable.from([Buffer.from('%PDF')]) }) })
  await assert.rejects(pdf.fetch('https://example.com/job.pdf'), code('UNSUPPORTED_CONTENT'))
  const gone = fetcher({ 'https://example.com/gone': () => ({ ...html(), status: 404 }) })
  await assert.rejects(gone.fetch('https://example.com/gone'), code('REMOTE_UNAVAILABLE'))
  const refused = fetcher({ 'https://example.com/down': () => { throw new Error('ECONNREFUSED 93.184.216.34') } })
  await assert.rejects(refused.fetch('https://example.com/down'), (error: Error & { code?: string }) => error.code === 'REMOTE_UNAVAILABLE' && !error.message.includes('ECONNREFUSED'))
  const text = fetcher({ 'https://example.com/job.txt': () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Readable.from([Buffer.from(DESCRIPTION)]) }) })
  assert.equal((await text.fetch('https://example.com/job.txt')).method, 'text')
})
test('at most two imports run at once', async () => {
  let release = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  const { fetch } = fetcher({ 'https://example.com/job': async () => { await held; return html() } })
  const running = [fetch('https://example.com/job'), fetch('https://example.com/job')]
  await assert.rejects(fetch('https://example.com/job'), code('IMPORT_BUSY'))
  release()
  assert.equal((await Promise.all(running)).length, 2)
  assert.equal((await fetch('https://example.com/job')).method, 'html')
})
test('the real transport connects to the validated address, keeps the hostname and decompresses', async () => {
  let host: string | undefined, cookie: string | undefined
  const server = createServer((req, res) => { host = req.headers.host; cookie = req.headers.cookie; res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' }); res.end(gzipSync('<p>hello</p>')) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address() as { port: number }
    // posting.invalid never resolves: reaching the server proves the given address was used.
    const response = await nodeTransport({ url: new URL(`http://posting.invalid:${port}/job`), address: '127.0.0.1', family: 4 }, new AbortController().signal)
    let body = ''
    for await (const chunk of response.body) body += chunk
    assert.equal(body, '<p>hello</p>')
    assert.equal(host, `posting.invalid:${port}`)
    assert.equal(cookie, undefined)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

async function call(handler: ReturnType<typeof api>, body: unknown, headers: Record<string, string> = {}) {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage
  req.method = 'POST'; req.url = '/api/job-postings/fetch'; req.headers = { host: 'localhost:5173', 'content-type': 'application/json', ...headers }
  let status = 0, value = ''
  const res = { writeHead(code: number) { status = code }, end(text: string) { value = text } } as unknown as ServerResponse
  await handler(req, res)
  return { status, value: JSON.parse(value) }
}
test('the import route returns text and metadata without touching AI or storage', async () => {
  // Any store access or AI request would throw on these stand-ins.
  const store = {} as PostgresStore
  const noAi = (() => { throw new Error('AI must not be called') }) as unknown as typeof fetch
  const routes = { 'https://example.com/job': () => html(), 'https://example.com/login': () => html(page('<main><p>Loading…</p></main>')) }
  const handler = api(store, noAi, fetcher(routes).fetch)
  const imported = await call(handler, { url: 'https://example.com/job' })
  assert.equal(imported.status, 200)
  assert.deepEqual(Object.keys(imported.value).sort(), ['capturedAt', 'method', 'requestedUrl', 'resolvedUrl', 'text'])
  const empty = await call(handler, { url: 'https://example.com/login' })
  assert.equal(empty.status, 502); assert.equal(empty.value.code, 'NO_JOB_CONTENT'); assert.match(empty.value.error, /^Couldn't retrieve this job posting/)
  assert.deepEqual((await call(handler, { url: 'http://127.0.0.1/admin' })).value.code, 'BLOCKED_DESTINATION')
  assert.equal((await call(handler, { url: 'http://127.0.0.1/admin' })).status, 403)
  assert.equal((await call(handler, { url: 'javascript:alert(1)' })).status, 422)
  assert.equal((await call(handler, { url: 'https://example.com/job', extra: true })).status, 422)
  assert.equal((await call(handler, { url: 'https://example.com/job' }, { origin: 'https://evil.example' })).status, 403)
})

test('job description Markdown round-trips legacy documents, provenance and headings inside the original text', () => {
  const legacy = '# Job Description\n\nSource: https://example.com/job\nCaptured on: 2026-01-10\n\n## Original text\n\nBuild things.\n\n## Technologies\n\n- Node.js\n'
  assert.equal(parseJobDescription(legacy).provenance, undefined)
  assert.equal(serializeJobDescription(parseJobDescription(legacy)), legacy)
  const originalText = '## About us\n\nWe build things.\n\n## Technologies\n\nNode.js, SQL\n\n## Original text\n\n\\## Key requirements'
  const provenance = { inputKind: 'url', capturedAt: '2026-10-04T10:40:00.000Z', resolvedUrl: 'https://careers.example.com/job', method: 'json_ld', edited: true } as const
  const description = { ...emptyJobDescription(), source: 'https://example.com/job', capturedOn: '2026-10-04', originalText, technologies: ['Node.js'], provenance }
  const markdown = serializeJobDescription(description)
  assert.deepEqual(parseJobDescription(markdown), description)
  assert.equal(serializeJobDescription(parseJobDescription(markdown)), markdown)
  const manual = { ...emptyJobDescription(), originalText: 'Pasted', provenance: { inputKind: 'manual', capturedAt: '2026-10-04T10:40:00.000Z' } as const }
  assert.deepEqual(parseJobDescription(serializeJobDescription(manual)), manual)
  // Incoherent provenance lines are kept as text, not interpreted.
  const forged = '# Job Description\n\nInput: url\nCaptured at: yesterday\n\n## Original text\n\nBuild things.\n'
  assert.equal(parseJobDescription(forged).provenance, undefined)
  assert.match(parseJobDescription(forged).other, /Input: url/)
})
