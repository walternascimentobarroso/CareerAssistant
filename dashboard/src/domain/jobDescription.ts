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

export type ListSection = keyof typeof LIST_SECTIONS

export const LIST_SECTION_LABELS: Record<ListSection, string> = LIST_SECTIONS

export type JobDescription = Record<ListSection, string[]> & {
  source: string
  capturedOn: string
  originalText: string
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
    lines[current].push(line)
  }

  const description = emptyJobDescription()
  const unrecognized: string[] = []
  for (const line of lines.preamble) {
    if (line.startsWith(SOURCE_PREFIX)) description.source = line.slice(SOURCE_PREFIX.length).trim()
    else if (line.startsWith(CAPTURED_ON_PREFIX)) description.capturedOn = line.slice(CAPTURED_ON_PREFIX.length).trim()
    else if (line.trim() !== TITLE) unrecognized.push(line)
  }
  description.originalText = lines.originalText.join('\n').trim()
  for (const section of listSections()) description[section] = linesToItems(lines[section].join('\n'))
  description.other = [...unrecognized, ...lines.other].join('\n').trim()
  return description
}

export function serializeJobDescription(description: JobDescription) {
  const header = [
    description.source && `${SOURCE_PREFIX} ${description.source}`,
    description.capturedOn && `${CAPTURED_ON_PREFIX} ${description.capturedOn}`,
  ].filter(Boolean)

  const blocks = [TITLE, header.join('\n'), `## ${ORIGINAL_TEXT_HEADING}`, description.originalText.trim()]
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
