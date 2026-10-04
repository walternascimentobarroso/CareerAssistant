import { CAPTURE_METHODS, type JobPostingProvenance } from './jobPosting.ts'

export const JOB_DESCRIPTION_FILE = 'job-description.md'

const LIST_SECTIONS = {
  keyRequirements: 'Key requirements',
  niceToHave: 'Nice to have',
  technologies: 'Technologies',
  openQuestions: 'Open questions',
} as const

const ORIGINAL_TEXT_HEADING = 'Original text'
const SOURCE_PREFIX = 'Source:'
const CAPTURED_ON_PREFIX = 'Captured on:'
const TITLE = '# Job Description'
// Distinct from `Source:`/`Captured on:`, which stay editable and may describe a legacy record.
const PROVENANCE_PREFIXES = {
  inputKind: 'Input:',
  capturedAt: 'Captured at:',
  resolvedUrl: 'Resolved URL:',
  method: 'Capture method:',
  edited: 'Edited after capture:',
} as const
type ProvenanceField = keyof typeof PROVENANCE_PREFIXES
const PROVENANCE_FIELDS = Object.keys(PROVENANCE_PREFIXES) as ProvenanceField[]
const ESCAPED_HEADING = /^\\+(## .*)$/

export type ListSection = keyof typeof LIST_SECTIONS

export const LIST_SECTION_LABELS: Record<ListSection, string> = LIST_SECTIONS

export type JobDescription = Record<ListSection, string[]> & {
  source: string
  capturedOn: string
  originalText: string
  provenance?: JobPostingProvenance
  /** Anything the form has no field for; written back verbatim so nothing is lost. */
  other: string
}

type Section = ListSection | 'preamble' | 'originalText' | 'other'

export function emptyJobDescription(): JobDescription {
  return {
    source: '',
    capturedOn: '',
    originalText: '',
    keyRequirements: [],
    niceToHave: [],
    technologies: [],
    openQuestions: [],
    other: '',
  }
}

export function parseJobDescription(markdown: string): JobDescription {
  const lines: Record<Section, string[]> = {
    preamble: [],
    originalText: [],
    keyRequirements: [],
    niceToHave: [],
    technologies: [],
    openQuestions: [],
    other: [],
  }
  let current: Section = 'preamble'

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## +(.+?) *$/.exec(line)?.[1]
    const known = heading === undefined ? undefined : sectionForHeading(heading)
    if (known) {
      current = known
      continue
    }
    // A pasted posting may have its own headings; they stay part of the original text.
    if (heading !== undefined && current !== 'originalText') current = 'other'
    lines[current].push(current === 'originalText' ? unescapeHeading(line) : line)
  }

  const description = emptyJobDescription()
  const unrecognized: string[] = []
  const provenanceLines: Partial<Record<ProvenanceField, string>> = {}
  for (const line of lines.preamble) {
    const field = PROVENANCE_FIELDS.find((name) => line.startsWith(PROVENANCE_PREFIXES[name]))
    if (field) provenanceLines[field] = line
    else if (line.startsWith(SOURCE_PREFIX)) description.source = line.slice(SOURCE_PREFIX.length).trim()
    else if (line.startsWith(CAPTURED_ON_PREFIX)) description.capturedOn = line.slice(CAPTURED_ON_PREFIX.length).trim()
    else if (line.trim() !== TITLE) unrecognized.push(line)
  }
  description.provenance = provenanceFromLines(provenanceLines)
  // Lines that do not form a coherent provenance are kept as written instead of being dropped.
  if (!description.provenance) unrecognized.push(...Object.values(provenanceLines))
  description.originalText = lines.originalText.join('\n').trim()
  for (const section of listSections()) description[section] = linesToItems(lines[section].join('\n'))
  description.other = [...unrecognized, ...lines.other].join('\n').trim()
  return description
}

export function serializeJobDescription(description: JobDescription) {
  const header = [
    description.source && `${SOURCE_PREFIX} ${description.source}`,
    description.capturedOn && `${CAPTURED_ON_PREFIX} ${description.capturedOn}`,
    ...provenanceLines(description.provenance),
  ].filter(Boolean)

  const originalText = description.originalText.trim().split(/\r?\n/).map(escapeHeading).join('\n')
  const blocks = [TITLE, header.join('\n'), `## ${ORIGINAL_TEXT_HEADING}`, originalText]
  for (const section of listSections()) {
    if (description[section].length === 0) continue
    blocks.push(`## ${LIST_SECTIONS[section]}`, description[section].map((item) => `- ${item}`).join('\n'))
  }
  blocks.push(description.other.trim())
  return blocks.filter(Boolean).join('\n\n') + '\n'
}

export function linesToItems(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
}

export function listSections() {
  return Object.keys(LIST_SECTIONS) as ListSection[]
}

function sectionForHeading(heading: string): Section | undefined {
  const normalized = heading.toLowerCase()
  if (normalized === ORIGINAL_TEXT_HEADING.toLowerCase()) return 'originalText'
  return listSections().find((section) => LIST_SECTIONS[section].toLowerCase() === normalized)
}

function knownHeading(line: string) {
  const heading = /^## +(.+?) *$/.exec(line)?.[1]
  return heading !== undefined && sectionForHeading(heading) !== undefined
}

// A posting's own `## Technologies` must not be read back as the structured list.
function escapeHeading(line: string) {
  return knownHeading(line.replace(/^\\+/, '')) ? `\\${line}` : line
}

function unescapeHeading(line: string) {
  const escaped = ESCAPED_HEADING.exec(line)?.[1]
  return escaped !== undefined && knownHeading(escaped) ? line.slice(1) : line
}

function provenanceLines(provenance: JobPostingProvenance | undefined) {
  if (!provenance) return []
  return [
    `${PROVENANCE_PREFIXES.inputKind} ${provenance.inputKind}`,
    `${PROVENANCE_PREFIXES.capturedAt} ${provenance.capturedAt}`,
    provenance.resolvedUrl && `${PROVENANCE_PREFIXES.resolvedUrl} ${provenance.resolvedUrl}`,
    provenance.method && `${PROVENANCE_PREFIXES.method} ${provenance.method}`,
    provenance.edited !== undefined && `${PROVENANCE_PREFIXES.edited} ${provenance.edited ? 'yes' : 'no'}`,
  ]
}

function provenanceFromLines(lines: Partial<Record<ProvenanceField, string>>): JobPostingProvenance | undefined {
  const value = (field: ProvenanceField) => lines[field]?.slice(PROVENANCE_PREFIXES[field].length).trim()
  const inputKind = value('inputKind')
  const capturedAt = value('capturedAt')
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) return undefined
  if (inputKind === 'manual') return Object.keys(lines).length === 2 ? { inputKind, capturedAt } : undefined
  const resolvedUrl = value('resolvedUrl')
  const method = CAPTURE_METHODS.find((name) => name === value('method'))
  const edited = value('edited')
  if (inputKind !== 'url' || !resolvedUrl || !method || (edited !== 'yes' && edited !== 'no')) return undefined
  return { inputKind, capturedAt, resolvedUrl, method, edited: edited === 'yes' }
}
