import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { pipeline, type Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { FetchedJobPosting } from '../dashboard/src/domain/jobPosting.ts'
import { JobPostingError, extractJobPosting } from './job-posting-text.ts'

export type ResolvedAddress = { address: string; family: number }
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>
export type Transport = (target: { url: URL; address: string; family: number }, signal: AbortSignal) => Promise<{ status: number; headers: IncomingHttpHeaders; body: Readable }>
export type JobPostingFetcher = (url: string) => Promise<FetchedJobPosting>

const MAX_URL_LENGTH = 4096
const MAX_REDIRECTS = 5
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_CONCURRENT_IMPORTS = 2
const TIMEOUT_MS = 15_000
const ALLOWED_PORTS = ['', '80', '443']
const REDIRECT_STATUSES = [301, 302, 303, 307, 308]
const CONTENT_KINDS: Record<string, 'html' | 'text'> = { 'text/html': 'html', 'application/xhtml+xml': 'html', 'text/plain': 'text' }
const DECODERS: Record<string, (() => NodeJS.ReadWriteStream) | null> = { identity: null, gzip: createGunzip, 'x-gzip': createGunzip, deflate: createInflate, br: createBrotliDecompress }
const USER_AGENT = 'CareerAssistant/0.1 (personal job posting import)'

const NON_PUBLIC = new BlockList()
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) NON_PUBLIC.addSubnet(network, prefix, 'ipv4')
// Inside the global range but not ordinary hosts: protocol assignments/Teredo, documentation, 6to4 (embeds an IPv4 address).
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) NON_PUBLIC.addSubnet(network, prefix, 'ipv6')
// Everything outside global unicast is refused: loopback, link-local, unique-local, multicast, IPv4-mapped, NAT64.
const GLOBAL_IPV6 = new BlockList()
GLOBAL_IPV6.addSubnet('2000::', 3, 'ipv6')

export function isPublicAddress({ address, family }: ResolvedAddress) {
  if (family === 4) return !NON_PUBLIC.check(address, 'ipv4')
  return GLOBAL_IPV6.check(address, 'ipv6') && !NON_PUBLIC.check(address, 'ipv6')
}

function parseUrl(value: string) {
  const url = value.length <= MAX_URL_LENGTH && URL.canParse(value) ? new URL(value) : null
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !ALLOWED_PORTS.includes(url.port)) {
    throw new JobPostingError(422, 'INVALID_URL', 'use a public http(s) link without credentials or a custom port.')
  }
  // The fragment never reaches the server; query parameters stay because they may identify the posting.
  url.hash = ''
  return url
}

function redirectTarget(location: string, from: URL) {
  let target: URL
  try { target = parseUrl(new URL(location, from).href) } catch { throw new JobPostingError(403, 'BLOCKED_DESTINATION', 'the site redirected to a destination that is not allowed.') }
  if (from.protocol === 'https:' && target.protocol === 'http:') throw new JobPostingError(403, 'BLOCKED_DESTINATION', 'the site redirected from HTTPS to HTTP.')
  return target
}

async function publicAddress(url: URL, resolve: Resolver) {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host).catch(() => [])
  if (addresses.length === 0) throw new JobPostingError(502, 'REMOTE_UNAVAILABLE', 'the site could not be found.')
  if (!addresses.every(isPublicAddress)) throw new JobPostingError(403, 'BLOCKED_DESTINATION', 'the link points to a private or local address.')
  return addresses[0]
}

export const nodeTransport: Transport = ({ url, address, family }, signal) => new Promise((resolve, reject) => {
  const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
    agent: false,
    signal,
    // No cookies or credentials: only what a first anonymous visit would send.
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', 'Accept-Encoding': 'gzip, br' },
    // Connect to the address that was validated; resolving again here would reopen DNS rebinding. Hostname and SNI stay those of the URL.
    lookup: (_hostname, options, callback) => options.all ? callback(null, [{ address, family }]) : callback(null, address, family),
  }, response => {
    const encoding = response.headers['content-encoding']?.toLowerCase() ?? 'identity'
    if (!(encoding in DECODERS)) {
      response.destroy()
      reject(new JobPostingError(502, 'UNSUPPORTED_CONTENT', 'the site used an unsupported compression.'))
      return
    }
    const decoder = DECODERS[encoding]?.()
    const body = decoder ? pipeline(response, decoder, () => {}) as unknown as Readable : response
    resolve({ status: response.statusCode ?? 0, headers: response.headers, body })
  })
  request.on('error', reject)
  request.end()
})

async function readBody(body: Readable) {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of body) {
      size += chunk.length
      // Counted after decompression and regardless of Content-Length; never truncated silently.
      if (size > MAX_BODY_BYTES) throw new JobPostingError(413, 'RESPONSE_TOO_LARGE', 'the page is too large.')
      chunks.push(Buffer.from(chunk))
    }
  } catch (error) {
    if (error instanceof JobPostingError) throw error
    throw new JobPostingError(502, 'REMOTE_UNAVAILABLE', 'the site stopped answering.')
  }
  return Buffer.concat(chunks)
}

function decode(bytes: Buffer, charset: string | undefined) {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes) } catch { return new TextDecoder().decode(bytes) }
}

async function download(requested: URL, resolve: Resolver, transport: Transport, signal: AbortSignal) {
  let url = requested
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const target = { url, ...await publicAddress(url, resolve) }
    const response = await transport(target, signal).catch(error => {
      throw error instanceof JobPostingError ? error : new JobPostingError(502, 'REMOTE_UNAVAILABLE', 'the site could not be reached.')
    })
    const location = REDIRECT_STATUSES.includes(response.status) ? response.headers.location : undefined
    if (location) {
      response.body.destroy()
      url = redirectTarget(location, url)
      continue
    }
    const [mime, ...parameters] = (response.headers['content-type'] ?? '').toLowerCase().split(';').map(part => part.trim())
    const kind = CONTENT_KINDS[mime]
    if (response.status < 200 || response.status >= 300 || !kind) {
      response.body.destroy()
      if (kind) throw new JobPostingError(502, 'REMOTE_UNAVAILABLE', `the site answered with status ${response.status}.`)
      throw new JobPostingError(502, 'UNSUPPORTED_CONTENT', 'the link is not a web page.')
    }
    const charset = parameters.find(parameter => parameter.startsWith('charset='))?.slice('charset='.length).replaceAll('"', '')
    return { url, kind, content: decode(await readBody(response.body), charset) }
  }
  throw new JobPostingError(502, 'REMOTE_UNAVAILABLE', 'the site redirected too many times.')
}

const resolveHost: Resolver = hostname => lookup(hostname, { all: true })

export function createJobPostingFetcher(options: { resolve?: Resolver; transport?: Transport; now?: () => Date; timeoutMs?: number } = {}): JobPostingFetcher {
  const { resolve = resolveHost, transport = nodeTransport, now = () => new Date(), timeoutMs = TIMEOUT_MS } = options
  let active = 0
  return async input => {
    const requested = parseUrl(input)
    // A local single-user server: refuse instead of queueing without bound.
    if (active >= MAX_CONCURRENT_IMPORTS) throw new JobPostingError(429, 'IMPORT_BUSY', 'other imports are still running. Try again in a moment.')
    active++
    // One deadline for DNS, every redirect and the body.
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), timeoutMs)
    const timedOut = new Promise<never>((_, reject) => deadline.signal.addEventListener('abort', () => reject(new JobPostingError(504, 'FETCH_TIMEOUT', 'the site took too long to answer.'))))
    try {
      const page = await Promise.race([download(requested, resolve, transport, deadline.signal), timedOut])
      const { text, method } = extractJobPosting(page.content, page.kind)
      return { text, requestedUrl: requested.href, resolvedUrl: page.url.href, capturedAt: now().toISOString(), method }
    } finally {
      clearTimeout(timer)
      // Releases the socket of a download that lost the race.
      deadline.abort()
      active--
    }
  }
}
