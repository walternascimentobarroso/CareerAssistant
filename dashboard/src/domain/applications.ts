import { splitFrontmatter } from './frontmatter'
import { capitalize } from './format'
import { applicationSchema, type ApplicationData } from './schema'

const APPLICATION_FILE = 'application.md'
const INTERVIEWS_DIR = 'interviews/'

export type Interview = { slug: string; title: string; documents: string[] }

export type Application = {
  slug: string
  data: ApplicationData
  notes: string
  /** Every Markdown file of the application folder, keyed by its path inside the folder. */
  documents: Record<string, string>
  interviews: Interview[]
}

export type ApplicationError = { slug: string; issues: string[] }

type ParsedApplication = { data: ApplicationData; notes: string } | { issues: string[] }

/** `files` maps paths relative to `applications/` (e.g. `acme-backend/application.md`) to their content. */
export function buildApplications(files: Record<string, string>) {
  const applications: Application[] = []
  const errors: ApplicationError[] = []

  for (const [slug, documents] of Object.entries(groupBySlug(files))) {
    const parsed = parseApplication(documents[APPLICATION_FILE])
    if ('issues' in parsed) {
      errors.push({ slug, issues: parsed.issues })
      continue
    }
    applications.push({ slug, ...parsed, documents, interviews: listInterviews(documents) })
  }

  return { applications, errors }
}

function groupBySlug(files: Record<string, string>) {
  const documentsBySlug: Record<string, Record<string, string>> = {}
  for (const [path, content] of Object.entries(files)) {
    const separator = path.indexOf('/')
    if (separator === -1) continue
    const slug = path.slice(0, separator)
    documentsBySlug[slug] ??= {}
    documentsBySlug[slug][path.slice(separator + 1)] = content
  }
  return documentsBySlug
}

function parseApplication(markdown: string | undefined): ParsedApplication {
  if (markdown === undefined) return { issues: [`missing ${APPLICATION_FILE}`] }

  try {
    const { frontmatter, body } = splitFrontmatter(markdown)
    const validation = applicationSchema.safeParse(frontmatter)
    if (validation.success) return { data: validation.data, notes: body }
    return {
      issues: validation.error.issues.map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`),
    }
  } catch (error) {
    return { issues: [`invalid frontmatter: ${(error as Error).message}`] }
  }
}

function listInterviews(documents: Record<string, string>): Interview[] {
  const documentsByInterview: Record<string, string[]> = {}
  for (const path of Object.keys(documents)) {
    if (!path.startsWith(INTERVIEWS_DIR)) continue
    const slug = path.slice(INTERVIEWS_DIR.length).split('/')[0]
    documentsByInterview[slug] ??= []
    documentsByInterview[slug].push(path)
  }

  return Object.entries(documentsByInterview)
    .map(([slug, paths]) => ({ slug, title: interviewTitle(slug), documents: paths.sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

function interviewTitle(slug: string) {
  const [order, ...words] = slug.split('-')
  return `${order} - ${capitalize(words.join(' '))}`
}
