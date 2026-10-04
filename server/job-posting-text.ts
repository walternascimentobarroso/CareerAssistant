import { load, type CheerioAPI } from 'cheerio'
import type { CaptureMethod } from '../dashboard/src/domain/jobPosting.ts'
import { StoreError } from './store.ts'

export type JobPostingErrorCode = 'INVALID_URL' | 'BLOCKED_DESTINATION' | 'FETCH_TIMEOUT' | 'RESPONSE_TOO_LARGE' | 'UNSUPPORTED_CONTENT' | 'REMOTE_UNAVAILABLE' | 'NO_JOB_CONTENT' | 'IMPORT_BUSY'
export class JobPostingError extends StoreError {
  public code: JobPostingErrorCode
  constructor(status: number, code: JobPostingErrorCode, reason: string) {
    super(status, `Couldn't retrieve this job posting: ${reason}`)
    this.code = code
  }
}

// A heuristic for "there is a posting here", not proof that the text is one.
export const MIN_TEXT_LENGTH = 200
export const MAX_TEXT_LENGTH = 100_000
const BLOCK_PAGE_MAX_LENGTH = 2_000
const BLOCK_PAGE = /captcha|verify (?:that )?you are (?:a )?human|are you a robot|access denied|unusual traffic|just a moment|enable javascript|(?:sign|log) in to (?:continue|view|see)|please (?:sign|log) in/i
const NOISE = 'script,style,noscript,template,svg,iframe,nav,footer,form,button,select'
const DESCRIPTION_CONTAINERS = ['[itemprop="description"]', '[class*="job-description" i]', '[id*="job-description" i]', '[class*="jobdescription" i]', '[id*="jobdescription" i]', 'main', '[role="main"]', 'article', 'body']
const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'ol', 'p', 'pre', 'section', 'table', 'ul'])
const LINES = new Set(['br', 'li', 'tr'])

type DomNode = ReturnType<ReturnType<CheerioAPI>['contents']>[number]

function rawText(node: DomNode): string {
  if (node.type === 'text') return node.data.replace(/\s+/g, ' ')
  if (!('children' in node)) return ''
  const inner = node.children.map(rawText).join('')
  if (node.type !== 'tag') return inner
  if (node.name === 'br') return '\n'
  if (node.name === 'li') return `\n- ${inner.trim()}`
  if (LINES.has(node.name)) return `\n${inner}\n`
  return BLOCKS.has(node.name) ? `\n\n${inner}\n\n` : inner
}

function normalize(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function nodeText(node: DomNode) {
  return normalize(rawText(node))
}

function fragmentText(html: string) {
  const text = nodeText(load(html, null, false).root()[0])
  // Some sites publish the JSON-LD description as escaped markup; decoding once leaves tags behind.
  return /<\/?(?:p|br|li|ul|ol|div|strong|h\d)\b[^>]*>/i.test(text) ? nodeText(load(text, null, false).root()[0]) : text
}

function jobPostings(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(jobPostings)
  if (typeof value !== 'object' || value === null) return []
  const node = value as Record<string, unknown>
  const types = [node['@type']].flat()
  return [...(types.includes('JobPosting') ? [node] : []), ...jobPostings(node['@graph'])]
}

function jsonLdText($: CheerioAPI) {
  const texts = new Set<string>()
  $('script[type="application/ld+json"]').each((_, script) => {
    let parsed: unknown
    try { parsed = JSON.parse($(script).text()) } catch { return }
    for (const posting of jobPostings(parsed)) {
      if (typeof posting.description !== 'string') continue
      const description = fragmentText(posting.description)
      if (description.length < MIN_TEXT_LENGTH) continue
      texts.add(typeof posting.title === 'string' && posting.title.trim() ? `${posting.title.trim()}\n\n${description}` : description)
    }
  })
  if (texts.size > 1) throw new JobPostingError(502, 'NO_JOB_CONTENT', 'the page lists several postings; open a single one.')
  return [...texts][0]
}

function htmlText($: CheerioAPI) {
  $(NOISE).remove()
  for (const selector of DESCRIPTION_CONTAINERS) {
    const text = $(selector).toArray().map(nodeText).sort((a, b) => b.length - a.length)[0]
    if (text && text.length >= MIN_TEXT_LENGTH) return text
  }
  return undefined
}

function checked(text: string | undefined, method: CaptureMethod) {
  if (!text || text.length < MIN_TEXT_LENGTH) throw new JobPostingError(502, 'NO_JOB_CONTENT', 'no job description was found on the page.')
  if (text.length > MAX_TEXT_LENGTH) throw new JobPostingError(413, 'RESPONSE_TOO_LARGE', 'the page has too much text.')
  if (text.length < BLOCK_PAGE_MAX_LENGTH && BLOCK_PAGE.test(text)) throw new JobPostingError(502, 'NO_JOB_CONTENT', 'the site asked for a login or a human check.')
  return { text, method }
}

export function extractJobPosting(content: string, contentType: 'html' | 'text') {
  if (contentType === 'text') return checked(normalize(content), 'text')
  const $ = load(content)
  const structured = jsonLdText($)
  return structured ? checked(structured, 'json_ld') : checked(htmlText($), 'html')
}
