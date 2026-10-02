import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { STATUSES } from '../dashboard/src/domain/constants'
import { messageSchema } from '../dashboard/src/domain/messages'
import { timelineEntrySchema } from '../dashboard/src/domain/schema'
import { Ai, PROVIDER_IDS } from './ai'
import { EDITABLE_FIELDS, Store, StoreError } from './store'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v))
const content = z.string().min(1).max(1_000_000)
const statusInput = z.strictObject({ revision: hash, status: z.enum(STATUSES), date, keepNextAction: z.boolean().optional() })
const cvInput = z.strictObject({ content, revision: hash })
const createInput = z.strictObject({ name: z.string(), content })
const fields = z.partialRecord(z.enum(EDITABLE_FIELDS), z.unknown())
const items = z.array(z.string().min(1)).optional()
const jobSections = z.strictObject({ keyRequirements: items, niceToHave: items, technologies: items })
const createApplicationInput = z.strictObject({ fields, applied: z.boolean(), date, jobPosting: content.optional(), jobSections: jobSections.optional() })
const provider = z.enum(PROVIDER_IDS)
// Values end up as one line of the .env file, so nothing that could break out of it.
const envValue = z.string().regex(/^[\w.\-/:]+$/).max(500)
const settingsInput = z.strictObject({ provider, model: envValue.optional(), keys: z.partialRecord(provider, envValue).optional() })
const extractInput = z.strictObject({ text: content, provider: provider.optional(), model: envValue.optional() })
const updateApplicationInput = z.strictObject({ revision: hash, fields, event: timelineEntrySchema.optional() })
const deleteInput = z.strictObject({ revision: hash })
const noteInput = z.strictObject({ revision: hash, note: z.string().trim().min(1).max(100_000) })
const jobDescriptionInput = z.strictObject({ content, revision: hash.nullable() })
const messageFields = { title: messageSchema.shape.title, content: z.string().trim().min(1).max(100_000) }
const createMessageInput = z.strictObject(messageFields)
const saveMessageInput = z.strictObject({ ...messageFields, revision: hash })
const attachInput = z.strictObject({ name: z.string(), revision: hash, sourceRevision: hash, cvRevision: hash.nullable(), allowHistoricalEdit: z.boolean().optional() })

async function body(req: IncomingMessage) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > 1_100_000) throw new StoreError(413, 'Request too large')
  }
  try { return JSON.parse(raw) as unknown } catch { throw new StoreError(400, 'Invalid JSON') }
}
export function api(store: Store, fetcher: typeof fetch = fetch) {
  const ai = new Ai(store, fetcher)
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    try {
      const host = req.headers.host?.split(':')[0]
      if (host !== 'localhost' && host !== '127.0.0.1') throw new StoreError(403, 'Local host required')
      // No cross-origin access to this local file-writing API.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new StoreError(403, 'Origin not allowed')
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new StoreError(403, 'Origin not allowed')
      const segments = new URL(req.url!, 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const [, collection, id, action] = segments
      if (segments[0] !== 'api' || segments.length > 4) throw new StoreError(404, 'Endpoint not found')
      if (req.method !== 'GET' && !req.headers['content-type']?.startsWith('application/json')) throw new StoreError(415, 'Use application/json')
      if (collection === 'applications') {
        if (req.method === 'GET' && !action) return send(200, id ? store.application(id) : store.applications())
        if (req.method === 'POST' && !id) return send(201, store.createApplication(createApplicationInput.parse(await body(req))))
        if (id && !action && req.method === 'PATCH') return send(200, store.updateApplication(id, updateApplicationInput.parse(await body(req))))
        if (id && !action && req.method === 'DELETE') return send(200, store.deleteApplication(id, deleteInput.parse(await body(req))))
        if (id && action === 'notes' && req.method === 'POST') return send(200, store.appendNote(id, noteInput.parse(await body(req))))
        if (id && action === 'job-description' && req.method === 'PUT') return send(200, store.saveJobDescription(id, jobDescriptionInput.parse(await body(req))))
        if (id && action === 'status' && req.method === 'PATCH') return send(200, store.status(id, statusInput.parse(await body(req))))
        if (id && action === 'cv' && req.method === 'POST') return send(200, store.attachCv(id, attachInput.parse(await body(req))))
      }
      if (collection === 'cvs' && !action) {
        if (req.method === 'GET') return send(200, id ? store.cv(id) : store.cvs())
        if (req.method === 'POST' && !id) { const b = createInput.parse(await body(req)); return send(201, store.saveCv(b.name, b.content, null)) }
        if (req.method === 'PUT' && id) { const b = cvInput.parse(await body(req)); return send(200, store.saveCv(id, b.content, b.revision)) }
      }
      if (collection === 'messages' && !action) {
        if (req.method === 'GET' && !id) return send(200, store.messages())
        if (req.method === 'POST' && !id) return send(201, store.createMessage(createMessageInput.parse(await body(req))))
        if (req.method === 'PUT' && id) return send(200, store.saveMessage(id, saveMessageInput.parse(await body(req))))
        if (req.method === 'DELETE' && id) return send(200, store.deleteMessage(id, deleteInput.parse(await body(req))))
      }
      if (collection === 'settings' && !id) {
        if (req.method === 'GET') return send(200, ai.settings())
        if (req.method === 'PUT') return send(200, ai.saveSettings(settingsInput.parse(await body(req))))
      }
      if (collection === 'models' && id && !action && req.method === 'GET') return send(200, await ai.models(provider.parse(id)))
      if (collection === 'extract' && !id && req.method === 'POST') return send(200, await ai.extract(extractInput.parse(await body(req))))
      throw new StoreError(404, 'Endpoint not found')
    } catch (error) {
      if (error instanceof StoreError) return send(error.status, { error: error.message })
      if (error instanceof z.ZodError) return send(422, { error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
      console.error(error)
      send(500, { error: 'Unable to access files' })
    }
  }
}
