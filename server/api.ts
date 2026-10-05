import { savePersonalProfileSchema } from '../dashboard/src/domain/personalProfile.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { STATUSES } from '../dashboard/src/domain/constants.ts'
import { messageSchema } from '../dashboard/src/domain/messages.ts'
import { timelineEntrySchema } from '../dashboard/src/domain/schema.ts'
import { Ai, PROVIDER_IDS } from './ai.ts'
import { EDITABLE_FIELDS, StoreError } from './store.ts'
import type { PostgresStore } from './postgres-store.ts'
import { isoDate } from '../dashboard/src/domain/schema.ts'
import { jobPostingCaptureSchema } from '../dashboard/src/domain/jobPosting.ts'
import { createJobPostingFetcher, type JobPostingFetcher } from './job-posting-fetcher.ts'
import { JobPostingError } from './job-posting-text.ts'
import { knowledgeFieldsSchema, saveKnowledgeSchema } from '../dashboard/src/domain/knowledge.ts'
import { addAnswerSchema, preparationContextSchema, revisionSchema, saveAnswerSchema } from '../dashboard/src/domain/applicationPreparation.ts'

const hash = z.string().regex(/^(?:[1-9]\d*|[a-f0-9]{64})$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v))
const content = z.string().min(1).max(1_000_000)
const statusInput = z.strictObject({ revision: hash, status: z.enum(STATUSES), date, keepNextAction: z.boolean().optional() })
const cvInput = z.strictObject({ content, revision: hash })
const createInput = z.strictObject({ name: z.string(), content, derivedFromVersionId: z.uuid().optional() })
const fields = z.partialRecord(z.enum(EDITABLE_FIELDS), z.unknown()).refine(value => {
  const rate=value.rate as { requested?:unknown; minimum?:unknown } | null | undefined
  return !rate || [rate.requested,rate.minimum].every(amount=>amount===undefined || typeof amount==='string')
}, 'Monetary amounts must be decimal strings')
const items = z.array(z.string().min(1)).optional()
const jobSections = z.strictObject({ keyRequirements: items, niceToHave: items, technologies: items })
const createApplicationInput = z.strictObject({ fields, applied: z.boolean(), date, jobPosting: content.optional(), jobSections: jobSections.optional(), jobPostingCapture: jobPostingCaptureSchema.optional() })
  .refine(value => !value.jobPostingCapture || !!value.jobPosting, 'jobPostingCapture requires jobPosting')
const fetchJobPostingInput = z.strictObject({ url: z.string().trim().min(1) })
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
const selectCvInput = z.strictObject({ ...revisionSchema.shape, cvVersionId: z.uuid() })
const attachInput = z.strictObject({ name: z.string(), revision: hash, sourceRevision: hash, cvRevision: z.union([hash,z.uuid()]).nullable(), allowHistoricalEdit: z.boolean().optional() })

async function body(req: IncomingMessage) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (Buffer.byteLength(raw) > 1_100_000) throw new StoreError(413, 'Request too large')
  }
  try { return JSON.parse(raw) as unknown } catch { throw new StoreError(400, 'Invalid JSON') }
}
export function api(store: PostgresStore, fetcher: typeof fetch = fetch, fetchJobPosting: JobPostingFetcher = createJobPostingFetcher()) {
  const ai = new Ai(store, fetcher)
  return async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    try {
      const host = req.headers.host?.split(':')[0]
      if (host !== 'localhost' && host !== '127.0.0.1') throw new StoreError(403, 'Local host required')
      // No cross-origin access to this local API.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new StoreError(403, 'Origin not allowed')
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new StoreError(403, 'Origin not allowed')
      const segments = new URL(req.url!, 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const [, collection, id, action, target, answerId] = segments
      if (segments[0] !== 'api' || segments.length > (collection === 'preparations' ? 5 : collection === 'applications' && action === 'preparation' ? 6 : 4)) throw new StoreError(404, 'Endpoint not found')
      if (req.method !== 'GET' && !req.headers['content-type']?.startsWith('application/json')) throw new StoreError(415, 'Use application/json')
      if (collection === 'profile' && !id) {
        if (req.method === 'GET') return send(200, await store.personalProfile())
        if (req.method === 'PUT') {
          const parsed = savePersonalProfileSchema.safeParse(await body(req))
          if (!parsed.success) return send(400, { error: 'Invalid profile fields', fields: Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])) })
          return send(200, await store.savePersonalProfile(parsed.data))
        }
      }
      if (collection === 'knowledge' && !action) {
        if (req.method === 'GET') return send(200, id ? await store.knowledgeEntry(z.uuid().parse(id)) : await store.knowledge())
        if (req.method === 'POST' && !id) return send(201, await store.saveKnowledge(null, knowledgeFieldsSchema.parse(await body(req))))
        if (req.method === 'PATCH' && id) return send(200, await store.patchKnowledge(z.uuid().parse(id), await body(req)))
        if (req.method === 'PUT' && id) return send(200, await store.saveKnowledge(z.uuid().parse(id), saveKnowledgeSchema.parse(await body(req))))
        if (req.method === 'DELETE' && id) return send(200, await store.deleteKnowledge(z.uuid().parse(id), revisionSchema.parse(await body(req))))
      }
      if (collection === 'applications' && id && action === 'preparation' && target === 'answers' && answerId && segments.length === 6 && req.method === 'PATCH') {
        return send(200, await store.patchApplicationPreparationAnswer(id, z.uuid().parse(answerId), await body(req)))
      }
      if (collection === 'applications' && id && (action === 'preparations' || action === 'preparation') && !target) {
        if (req.method === 'GET') return send(200, await store.preparation(id))
        if (req.method === 'POST') return send(200, await store.startPreparation(id))
      }
      if (collection === 'preparations' && id) {
        const preparationId = z.uuid().parse(id)
        if (!action && req.method === 'PUT') return send(200, await store.updatePreparation(preparationId, preparationContextSchema.parse(await body(req))))
        if (action === 'select-cv' && !target && req.method === 'POST') return send(200, await store.selectPreparationCv(preparationId, selectCvInput.parse(await body(req))))
        if (action === 'resolve' && !target && req.method === 'POST') return send(200, await store.resolvePreparation(preparationId, revisionSchema.parse(await body(req))))
        if (action === 'answers' && !target && req.method === 'POST') return send(201, await store.addPreparationAnswer(preparationId, addAnswerSchema.parse(await body(req))))
        if (action === 'answers' && target && req.method === 'PUT') return send(200, await store.savePreparationAnswer(preparationId, z.uuid().parse(target), saveAnswerSchema.parse(await body(req))))
        if (action === 'answers' && target && req.method === 'DELETE') return send(200, await store.deletePreparationAnswer(preparationId, z.uuid().parse(target), revisionSchema.parse(await body(req))))
      }
      if (collection === 'config' && req.method === 'GET' && !id) return send(200, { timezone:store.timezone() })
      if (collection === 'trash' && req.method === 'GET' && !id) return send(200, await store.trash())
      if (collection === 'trash' && id && !action && req.method === 'DELETE') return send(200, await store.permanentlyDeleteApplication(id, deleteInput.parse(await body(req))))
      if (collection === 'applications' && id && req.method === 'POST') {
        if (action === 'restore') return send(200, await store.restoreApplication(id, deleteInput.parse(await body(req))))
        if (action === 'cv-send') return send(200, await store.sendCv(id, z.strictObject({ revision:hash, versionId:z.uuid(), date:isoDate, channel:z.string().optional() }).parse(await body(req))))
        if (action === 'cv-customize') return send(201, await store.customizeCv(id, z.strictObject({ revision:hash, content, sourceVersionId:z.uuid() }).parse(await body(req))))
        if (action === 'task-complete') return send(200, await store.completeTask(id, z.strictObject({ revision:hash, taskId:z.uuid() }).parse(await body(req))))
        if (action === 'interviews') {
          const instant=z.iso.datetime({ offset:true })
          const input=z.strictObject({ revision:hash, kind:z.string().trim().min(1), status:z.enum(['scheduled','completed','cancelled','unknown']), date:isoDate.optional(), startsAt:instant.optional(), endsAt:instant.optional(),
            timezone:z.string().refine(value => { try { new Intl.DateTimeFormat('en',{timeZone:value}); return true } catch { return false } },'Invalid IANA timezone').optional(),
            participants:z.array(z.strictObject({ name:z.string().trim().min(1),role:z.string().optional() })).optional(), notes:z.string().optional(),transcript:z.string().optional(),summary:z.string().optional()
          }).refine(value => !(value.date && value.startsAt),'Choose a date or an instant').refine(value => !value.endsAt || (!!value.startsAt && Date.parse(value.endsAt)>Date.parse(value.startsAt)),'End must follow start').parse(await body(req))
          return send(201,await store.createInterview(id,input))
        }
      }
      if (collection === 'cvs' && id && action === 'versions' && req.method === 'GET') return send(200,await store.cvVersions(id))
      if (collection === 'messages' && id && action === 'restore' && req.method === 'POST') return send(200,await store.restoreMessage(id,deleteInput.parse(await body(req))))
      if (collection === 'applications') {
        if (req.method === 'GET' && !action) return send(200, id ? await store.application(id) : await store.applications())
        if (req.method === 'POST' && !id) return send(201, await store.createApplication(createApplicationInput.parse(await body(req))))
        if (id && !action && req.method === 'PATCH') return send(200, await store.updateApplication(id, updateApplicationInput.parse(await body(req))))
        if (id && !action && req.method === 'DELETE') return send(200, await store.deleteApplication(id, deleteInput.parse(await body(req))))
        if (id && action === 'notes' && req.method === 'POST') return send(200, await store.appendNote(id, noteInput.parse(await body(req))))
        if (id && action === 'job-description' && req.method === 'PUT') return send(200, await store.saveJobDescription(id, jobDescriptionInput.parse(await body(req))))
        if (id && action === 'status' && req.method === 'PATCH') return send(200, await store.status(id, statusInput.parse(await body(req))))
        if (id && action === 'cv' && req.method === 'POST') return send(200, await store.attachCv(id, attachInput.parse(await body(req))))
      }
      if (collection === 'cvs' && !action) {
        if (req.method === 'GET') return send(200, id ? await store.cv(id) : await store.cvs())
        if (req.method === 'POST' && !id) { const b = createInput.parse(await body(req)); return send(201, await store.saveCv(b.name, b.content, null, { derivedFromVersionId:b.derivedFromVersionId })) }
        if (req.method === 'PUT' && id) { const b = cvInput.parse(await body(req)); return send(200, await store.saveCv(id, b.content, b.revision)) }
      }
      if (collection === 'messages' && !action) {
        if (req.method === 'GET' && !id) return send(200, await store.messages())
        if (req.method === 'POST' && !id) return send(201, await store.createMessage(createMessageInput.parse(await body(req))))
        if (req.method === 'PUT' && id) return send(200, await store.saveMessage(id, saveMessageInput.parse(await body(req))))
        if (req.method === 'DELETE' && id) return send(200, await store.deleteMessage(id, deleteInput.parse(await body(req))))
      }
      if (collection === 'settings' && !id) {
        if (req.method === 'GET') return send(200, ai.settings())
        if (req.method === 'PUT') return send(200, ai.saveSettings(settingsInput.parse(await body(req))))
      }
      if (collection === 'models' && id && !action && req.method === 'GET') return send(200, await ai.models(provider.parse(id)))
      if (collection === 'extract' && !id && req.method === 'POST') return send(200, await ai.extract(extractInput.parse(await body(req))))
      if (collection === 'job-postings' && id === 'fetch' && !action && req.method === 'POST') return send(200, await fetchJobPosting(fetchJobPostingInput.parse(await body(req)).url))
      throw new StoreError(404, 'Endpoint not found')
    } catch (error) {
      if (error instanceof JobPostingError) return send(error.status, { error: error.message, code: error.code })
      if (error instanceof StoreError) return send(error.status, { error: error.message })
      if (error instanceof z.ZodError) return send(422, { error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
      const code = (error as { code?: string }).code
      if (code === '23505') return send(409, { error:'A record with this identifier already exists, including removed records.' })
      if (code === '23503' || code === '23514') return send(409, { error:'This operation conflicts with a protected relationship or historical record.' })
      if (code === '40001' || code === '40P01') return send(409, { error:'Concurrent change. Reload and retry.' })
      console.error(error instanceof Error ? error.message : 'Unexpected database error')
      send(500, { error: 'Unable to access stored data' })
    }
  }
}
