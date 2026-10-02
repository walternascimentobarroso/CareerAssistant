import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isNode, isSeq, parseDocument, stringify } from 'yaml'
import { buildApplications } from '../dashboard/src/domain/applications'
import { slugify } from '../dashboard/src/domain/format'
import { JOB_DESCRIPTION_FILE, emptyJobDescription, serializeJobDescription, type JobDescription } from '../dashboard/src/domain/jobDescription'
import { applicationSchema, type TimelineEntry } from '../dashboard/src/domain/schema'
import { APPLIED_STATUS, CLOSED_STATUSES, INITIAL_STATUS, STATUSES, type Status } from '../dashboard/src/domain/constants'

export class StoreError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const revision = (content: string) => createHash('sha256').update(content).digest('hex')
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// status, timeline and cv have their own operations so their side effects are never skipped.
export const EDITABLE_FIELDS = ['company', 'role', 'priority', 'type', 'location', 'applied_at', 'job_url', 'rate', 'contact', 'next_action', 'tags'] as const
export type ApplicationFields = Partial<Record<(typeof EDITABLE_FIELDS)[number], unknown>>
type YamlDocument = ReturnType<typeof parseDocument>

function appendTimelineEntry(doc: YamlDocument, entry: TimelineEntry) {
  if (doc.get('timeline')) doc.addIn(['timeline'], entry)
  else doc.set('timeline', [entry])
}

export class Store {
  constructor(public root: string) { this.root = resolve(root) }
  path(relative: string) {
    const parts = relative.split('/')
    if (parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) throw new StoreError(400, 'Invalid path')
    let path = this.root
    for (const part of parts) {
      path = join(path, part)
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new StoreError(400, 'Symbolic links are not supported')
    }
    return path
  }
  id(value: string) {
    if (!identifier.test(value)) throw new StoreError(400, 'Use a lowercase kebab-case name')
    return value
  }
  read(relative: string) {
    const path = this.path(relative)
    if (!existsSync(path)) throw new StoreError(404, 'File not found')
    return readFileSync(path, 'utf8')
  }
  write(relative: string, content: string, expected: string | null) {
    const path = this.path(relative)
    const current = existsSync(path) ? revision(this.read(relative)) : null
    if (current !== expected) throw new StoreError(409, 'File changed. Reload before saving.')
    const temporary = join(dirname(path), `.write-${randomUUID()}`)
    try {
      writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
      // Recheck immediately before replacement, including edits made outside the app.
      if ((existsSync(path) ? revision(this.read(relative)) : null) !== expected) throw new StoreError(409, 'File changed. Reload before saving.')
      renameSync(temporary, path)
    } finally { if (existsSync(temporary)) unlinkSync(temporary) }
    return revision(content)
  }
  applications() {
    const files: Record<string, string> = {}
    const walk = (relative: string) => {
      for (const item of readdirSync(this.path(relative), { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue
        const child = `${relative}/${item.name}`
        if (item.isDirectory()) walk(child)
        else if (item.isFile() && item.name.endsWith('.md')) files[child.slice('applications/'.length)] = this.read(child)
      }
    }
    walk('applications')
    const result = buildApplications(files)
    return { ...result, applications: result.applications.map(a => ({ ...a, revision: revision(a.documents['application.md']) })) }
  }
  application(slug: string) {
    this.id(slug)
    const a = this.applications().applications.find(a => a.slug === slug)
    if (!a) throw new StoreError(404, 'Application missing or invalid')
    return a
  }
  editApplication(slug: string, expected: string, edit: (doc: YamlDocument) => void) {
    const relative = `applications/${this.id(slug)}/application.md`
    const raw = this.read(relative)
    if (revision(raw) !== expected) throw new StoreError(409, 'File changed. Reload before saving.')
    const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))([\s\S]*)$/.exec(raw)
    if (!match) throw new StoreError(422, 'Invalid frontmatter')
    const original = parseDocument(match[2])
    const doc = parseDocument(match[2])
    if (doc.errors.length) throw new StoreError(422, 'Invalid YAML')
    applicationSchema.parse(doc.toJS())
    edit(doc)
    applicationSchema.parse(doc.toJS())
    const eol = match[1].includes('\r') ? '\r\n' : '\n'
    const before = original.toJS() as Record<string, unknown>
    const after = doc.toJS() as Record<string, unknown>
    const patches: { start: number; end: number; text: string }[] = []
    // New keys go after every patch so they cannot land inside a collection patched at the end of the document.
    const additions: string[] = []
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue
      const node = original.get(key, true)
      const range = node && typeof node === 'object' && 'range' in node ? node.range as [number, number, number] | null : null
      if (key === 'timeline' && isSeq(node) && !node.flow && range && Array.isArray(before[key]) && Array.isArray(after[key])) {
        const previous = before[key] as unknown[]
        const next = after[key] as unknown[]
        if (JSON.stringify(next.slice(0, previous.length)) === JSON.stringify(previous)) {
          const firstRange = isNode(node.items[0]) ? node.items[0].range : null
          const firstOffset = firstRange?.[0] ?? range[0]
          const lineStart = match[2].lastIndexOf('\n', firstOffset - 1) + 1
          const indentation = match[2].slice(lineStart, firstOffset).match(/^ */)?.[0] ?? '  '
          const addition = stringify(next.slice(previous.length)).trimEnd().split('\n').map(line => indentation + line).join(eol)
          // A block sequence already ends with a line break unless it is the last line of the frontmatter.
          const lineBreak = /\r?\n$/.test(match[2].slice(0, range[1])) ? '' : eol
          patches.push({ start: range[1], end: range[1], text: lineBreak + addition + eol })
          continue
        }
      }
      const keyStart = () => {
        const keyNode = original.contents && 'items' in original.contents ? original.contents.items.find(item => item && typeof item === 'object' && 'key' in item && String(item.key) === key) : undefined
        const keyRange = keyNode && 'key' in keyNode && keyNode.key && typeof keyNode.key === 'object' && 'range' in keyNode.key ? keyNode.key.range : null
        if (!keyRange) throw new StoreError(422, 'Unsupported YAML layout')
        return keyRange[0]
      }
      if (range && key in after && typeof after[key] === 'object') {
        // Block collections end after their line break; keep it so the next key stays on its own line.
        const lineBreak = /\r?\n$/.exec(match[2].slice(range[0], range[1]))?.[0] ?? ''
        patches.push({ start: keyStart(), end: range[1], text: stringify({ [key]: after[key] }).trimEnd().replace(/\n/g, eol) + lineBreak })
      } else if (range && key in after) {
        patches.push({ start: range[0], end: range[1], text: stringify(after[key]).trimEnd().replace(/\n/g, eol) })
      } else if (range) {
        patches.push({ start: keyStart(), end: range[2], text: '' })
      } else {
        additions.push(stringify({ [key]: after[key] }).trimEnd().replace(/\n/g, eol))
      }
    }
    let yaml = match[2]
    for (const patch of patches.sort((a, b) => b.start - a.start)) yaml = yaml.slice(0, patch.start) + patch.text + yaml.slice(patch.end)
    for (const addition of additions) yaml = yaml.replace(/(\r?\n)?$/, eol) + addition
    applicationSchema.parse(parseDocument(yaml).toJS())
    this.write(relative, match[1] + yaml + match[3] + match[4], expected)
    return this.application(slug)
  }
  status(slug: string, input: { revision: string; status: Status; date: string; keepNextAction?: boolean }) {
    const a = this.application(slug)
    if (a.revision !== input.revision) throw new StoreError(409, 'File changed. Reload before saving.')
    if (!STATUSES.includes(input.status)) throw new StoreError(400, 'Invalid status')
    if (a.data.status === input.status) return a
    return this.editApplication(slug, input.revision, doc => {
      doc.set('status', input.status)
      if (input.status === APPLIED_STATUS && !a.data.applied_at) doc.set('applied_at', input.date)
      appendTimelineEntry(doc, { date: input.date, type: 'status_changed', description: `Status changed from ${a.data.status} to ${input.status}` })
      if (CLOSED_STATUSES.includes(input.status) && !input.keepNextAction) doc.delete('next_action')
    })
  }
  createApplication(input: { fields: ApplicationFields; applied: boolean; date: string; jobPosting?: string; jobSections?: Partial<Pick<JobDescription, 'keyRequirements' | 'niceToHave' | 'technologies'>> }) {
    const fields = Object.fromEntries(Object.entries(input.fields).filter(([, value]) => value !== null))
    const slug = slugify(`${fields.company ?? ''} ${fields.role ?? ''}`)
    if (!slug) throw new StoreError(400, 'Company and role are required')
    const directory = this.path(`applications/${slug}`)
    if (existsSync(directory)) throw new StoreError(409, `Application ${slug} already exists`)
    const firstEvent = input.applied ? { type: 'applied', description: 'Application submitted' } : { type: 'created', description: 'Application created' }
    const data = applicationSchema.parse({
      status: input.applied ? APPLIED_STATUS : INITIAL_STATUS,
      ...(input.applied && { applied_at: input.date }),
      ...fields,
      timeline: [{ date: input.date, ...firstEvent }],
    })
    const { company, role, status, tags, timeline, ...optional } = data
    mkdirSync(directory)
    try {
      this.write(`applications/${slug}/application.md`, `---\n${stringify({ company, role, status, ...optional, tags, timeline })}---\n\n## Notes\n`, null)
      if (input.jobPosting) {
        const description = { ...emptyJobDescription(), ...input.jobSections, source: data.job_url ?? '', capturedOn: input.date, originalText: input.jobPosting }
        this.write(`applications/${slug}/${JOB_DESCRIPTION_FILE}`, serializeJobDescription(description), null)
      }
    } catch (error) {
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
    return this.application(slug)
  }
  updateApplication(slug: string, input: { revision: string; fields: ApplicationFields; event?: TimelineEntry }) {
    return this.editApplication(slug, input.revision, doc => {
      const current = doc.toJS() as Record<string, unknown>
      for (const [key, value] of Object.entries(input.fields)) {
        if (value === null) doc.delete(key)
        // Untouched fields keep their original bytes, including key order and comments.
        else if (!isDeepStrictEqual(current[key], value)) doc.set(key, doc.createNode(value))
      }
      if (input.event) appendTimelineEntry(doc, input.event)
    })
  }
  appendNote(slug: string, input: { revision: string; note: string }) {
    const relative = `applications/${this.id(slug)}/application.md`
    const raw = this.read(relative)
    const eol = raw.includes('\r\n') ? '\r\n' : '\n'
    const separator = raw.endsWith(eol + eol) ? '' : raw.endsWith(eol) ? eol : eol + eol
    this.write(relative, raw + separator + input.note.trim().replace(/\r?\n/g, eol) + eol, input.revision)
    return this.application(slug)
  }
  saveJobDescription(slug: string, input: { content: string; revision: string | null }) {
    this.application(slug)
    this.write(`applications/${slug}/${JOB_DESCRIPTION_FILE}`, input.content, input.revision)
    return this.application(slug)
  }
  cvs() {
    return readdirSync(this.path('cv'), { withFileTypes: true }).filter(f => f.isFile() && f.name.endsWith('.md')).map(f => this.cv(f.name.slice(0, -3)))
  }
  cv(name: string) {
    const content = this.read(`cv/${this.id(name)}.md`)
    return { name, content, revision: revision(content) }
  }
  saveCv(name: string, content: string, expected: string | null) {
    this.write(`cv/${this.id(name)}.md`, content, expected)
    return this.cv(name)
  }
  attachCv(slug: string, input: { name: string; revision: string; sourceRevision: string; cvRevision: string | null; allowHistoricalEdit?: boolean }) {
    const a = this.application(slug)
    const source = this.cv(input.name)
    if (source.revision !== input.sourceRevision || a.revision !== input.revision) throw new StoreError(409, 'Files changed. Reload before saving.')
    const relative = `applications/${this.id(slug)}/cv.md`
    const previous = existsSync(this.path(relative)) ? this.read(relative) : null
    if (a.data.status !== STATUSES[0] && previous !== null && !input.allowHistoricalEdit) throw new StoreError(409, 'Explicit permission required to replace a historical CV')
    if ((previous === null ? null : revision(previous)) !== input.cvRevision) throw new StoreError(409, 'CV changed. Reload before saving.')
    // All mutation work is synchronous, so API requests cannot interleave these writes.
    const newRevision = this.write(relative, source.content, input.cvRevision)
    try { return this.editApplication(slug, input.revision, doc => doc.set('cv', './cv.md')) }
    catch (error) {
      if (revision(this.read(relative)) === newRevision) {
        if (previous === null) unlinkSync(this.path(relative))
        else this.write(relative, previous, newRevision)
      }
      throw error
    }
  }
}
