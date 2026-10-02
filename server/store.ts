import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { isNode, isSeq, parseDocument, stringify } from 'yaml'
import { buildApplications } from '../dashboard/src/domain/applications'
import { applicationSchema } from '../dashboard/src/domain/schema'
import { CLOSED_STATUSES, STATUSES, type Status } from '../dashboard/src/domain/constants'

export class StoreError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const revision = (content: string) => createHash('sha256').update(content).digest('hex')
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
  editApplication(slug: string, expected: string, edit: (doc: ReturnType<typeof parseDocument>) => void) {
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
          patches.push({ start: range[1], end: range[1], text: eol + addition + eol })
          continue
        }
      }
      if (range && key in after) {
        const serialized = typeof after[key] === 'object' ? JSON.stringify(after[key]) : stringify(after[key]).trimEnd().replace(/\n/g, eol)
        patches.push({ start: range[0], end: range[1], text: serialized })
      } else if (range) {
        const keyNode = original.contents && 'items' in original.contents ? original.contents.items.find(item => item && typeof item === 'object' && 'key' in item && String(item.key) === key) : undefined
        const keyRange = keyNode && 'key' in keyNode && keyNode.key && typeof keyNode.key === 'object' && 'range' in keyNode.key ? keyNode.key.range : null
        if (!keyRange) throw new StoreError(422, 'Unsupported YAML layout')
        patches.push({ start: keyRange[0], end: range[2], text: '' })
      } else {
        patches.push({ start: match[2].length, end: match[2].length, text: eol + stringify({ [key]: after[key] }).trimEnd().replace(/\n/g, eol) })
      }
    }
    let yaml = match[2]
    for (const patch of patches.sort((a, b) => b.start - a.start)) yaml = yaml.slice(0, patch.start) + patch.text + yaml.slice(patch.end)
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
      const timeline = doc.get('timeline')
      const entry = { date: input.date, type: 'status_changed', description: `Status changed from ${a.data.status} to ${input.status}` }
      if (timeline) doc.addIn(['timeline'], entry)
      else doc.set('timeline', [entry])
      if (CLOSED_STATUSES.includes(input.status) && !input.keepNextAction) doc.delete('next_action')
    })
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
