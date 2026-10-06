import type { FormSnapshot } from './form-sessions.ts'
import { personalProfileSchema, savePersonalProfileSchema, type PersonalProfile, type PersonalProfileFields } from '../dashboard/src/domain/personalProfile.ts'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'
import { isDeepStrictEqual } from 'node:util'
import { stringify } from 'yaml'
import { Store, StoreError, revision, type ApplicationFields } from './store.ts'
import { transaction, environment } from './db/connection.ts'
import { applicationSchema, isoDate, type ApplicationData, type TimelineEntry } from '../dashboard/src/domain/schema.ts'
import { slugify, todayIsoDate, setPersonalTimezone } from '../dashboard/src/domain/format.ts'
import { CLOSED_STATUSES, type Status } from '../dashboard/src/domain/constants.ts'
import { emptyJobDescription, parseJobDescription, serializeJobDescription, type JobDescription } from '../dashboard/src/domain/jobDescription.ts'
import type { JobPostingCapture, JobPostingProvenance } from '../dashboard/src/domain/jobPosting.ts'
import type { LiveApplication } from '../dashboard/src/data/loadApplications.tsx'
import { knowledgeFieldsSchema, saveKnowledgeSchema, answerValueSchema, contextKey, normalizeText, type KnowledgeEntry, type KnowledgeFields, type Restriction } from '../dashboard/src/domain/knowledge.ts'
import { saveAnswerSchema, answerFits, type Preparation, type PreparationAnswer, type Requirement, type ResolutionContext, type SaveAnswer } from '../dashboard/src/domain/applicationPreparation.ts'
import { contextValues, resolveAnswer } from './application-answer-resolver.ts'

type Queryable = Pool | PoolClient
export type CreateApplicationInput = { fields: ApplicationFields; applied: boolean; date: string; jobPosting?: string; jobSections?: Partial<Pick<JobDescription, 'keyRequirements' | 'niceToHave' | 'technologies'>>; jobPostingCapture?: JobPostingCapture }
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const JOB_DESCRIPTION_COLUMNS = 'description_md,description_source,description_captured_on,description_input_kind,description_captured_at,description_resolved_url,description_capture_method,description_edited_after_capture'
const optional = <T>(value: T | null): T | undefined => value === null ? undefined : value

function dateInTimezone(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
function provenanceFromJob(job: { description_input_kind: 'manual' | 'url' | null; description_captured_at: Date | null; description_resolved_url: string | null; description_capture_method: JobPostingProvenance['method'] | null; description_edited_after_capture: boolean | null }): JobPostingProvenance | undefined {
  if (!job.description_input_kind || !job.description_captured_at) return undefined
  return { inputKind:job.description_input_kind, capturedAt:job.description_captured_at.toISOString(), resolvedUrl:optional(job.description_resolved_url), method:optional(job.description_capture_method), edited:optional(job.description_edited_after_capture) }
}
function descriptionColumns(description: JobDescription | null, markdown: string | null) {
  const provenance = description?.provenance
  return [markdown, description?.source || null, description?.capturedOn && isoDate.safeParse(description.capturedOn).success ? description.capturedOn : null,
    provenance?.inputKind ?? null, provenance?.capturedAt ?? null, provenance?.resolvedUrl ?? null, provenance?.method ?? null, provenance?.edited ?? null]
}

/** PostgreSQL is the only runtime source of domain data. Files are configuration/static assets. */
export class PostgresStore {
  private files: Store
  public root: string
  public pool: Pool
  constructor(root: string, pool: Pool) {
    this.root = root
    this.pool = pool
    this.files = new Store(root)
    setPersonalTimezone(this.timezone())
  }
  path(relative: string) { return this.files.path(relative) }
  read(relative: string) {
    if (relative !== '.env') throw new StoreError(400, 'Only configuration may be read from files at runtime')
    return this.files.read(relative)
  }
  write(relative: string, content: string, expected: string | null) {
    if (relative !== '.env') throw new StoreError(400, 'Domain data must be written to PostgreSQL')
    return this.files.write(relative, content, expected)
  }
  id(value: string) {
    if (!identifier.test(value) && !/^[a-f0-9-]{36}$/i.test(value)) throw new StoreError(400, 'Invalid identifier')
    return value
  }
  private async lockedApplication(client: PoolClient, slug: string, expected?: string, removed = false) {
    this.id(slug)
    const { rows } = await client.query('SELECT * FROM applications WHERE (slug=$1 OR id::text=$1) AND (deleted_at IS NULL)=$2 FOR UPDATE', [slug,!removed])
    if (!rows.length) throw new StoreError(404, 'Application not found')
    if (expected !== undefined && String(rows[0].row_version) !== expected) throw new StoreError(409, 'Application changed. Reload before saving.')
    return rows[0]
  }
  async personalProfile(query: Queryable = this.pool): Promise<{ profile: PersonalProfile | null }> {
    if (query === this.pool) return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      return this.personalProfile(client)
    })
    const { rows } = await query.query('SELECT * FROM personal_profiles WHERE deleted_at IS NULL')
    if (!rows.length) return { profile: null }
    const row = rows[0]
    const fields: Record<string, unknown> = {}
    for (const key of Object.keys(personalProfileSchema.shape).filter(k => !['workAuthorizations','languages','contractPreferences'].includes(k))) {
      fields[key] = row[key.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]
    }
    const authorizations = await query.query('SELECT country,"authorization",sponsorship,notes FROM personal_profile_work_authorizations WHERE profile_id=$1 AND deleted_at IS NULL ORDER BY created_at,id', [row.id])
    const languages = await query.query('SELECT code,level FROM personal_profile_languages WHERE profile_id=$1 AND deleted_at IS NULL ORDER BY created_at,id', [row.id])
    const contracts = await query.query('SELECT contract_type FROM personal_profile_contract_preferences WHERE profile_id=$1 AND deleted_at IS NULL ORDER BY created_at,id', [row.id])
    return { profile: { ...personalProfileSchema.parse({ ...fields, workAuthorizations: authorizations.rows, languages: languages.rows, contractPreferences: contracts.rows.map(r => r.contract_type) }), id: row.id, revision: String(row.row_version) } }
  }
  async savePersonalProfile(input: PersonalProfileFields & { revision: string | null }) {
    const { revision: expected, ...fields } = savePersonalProfileSchema.parse(input)
    try {
      return await transaction(this.pool, async client => {
        const { rows } = await client.query('SELECT id,row_version FROM personal_profiles WHERE deleted_at IS NULL FOR UPDATE')
        if ((rows.length && String(rows[0].row_version) !== expected) || (!rows.length && expected !== null)) throw new StoreError(409, 'Profile changed. Load the current version before saving.')
        const keys = Object.keys(personalProfileSchema.shape).filter(k => !['workAuthorizations','languages','contractPreferences'].includes(k)) as (keyof PersonalProfileFields)[]
        const columns = keys.map(k => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()))
        const values = keys.map(k => fields[k])
        let id: string
        if (rows.length) {
          id = rows[0].id
          await client.query(`UPDATE personal_profiles SET ${columns.map((c,i) => `${c}=$${i+2}`).join(',')} WHERE id=$1`, [id,...values])
        } else {
          const created = await client.query(`INSERT INTO personal_profiles (${columns.join(',')}) VALUES (${values.map((_,i) => `$${i+1}`).join(',')}) RETURNING id`, values)
          id = created.rows[0].id
        }
        // Preserve identity for retained entries; removed items remain in history.
        const lists = [
          { table: 'personal_profile_work_authorizations', key: 'country', columns: ['country','authorization','sponsorship','notes'], items: fields.workAuthorizations },
          { table: 'personal_profile_languages', key: 'code', columns: ['code','level'], items: fields.languages },
          { table: 'personal_profile_contract_preferences', key: 'contract_type', columns: ['contract_type'], items: fields.contractPreferences.map(contract_type => ({ contract_type })) },
        ]
        for (const list of lists) {
          const items = list.items as Record<string, unknown>[]
          await client.query(`UPDATE ${list.table} SET deleted_at=clock_timestamp() WHERE profile_id=$1 AND deleted_at IS NULL AND NOT (${list.key}=ANY($2::text[]))`, [id,items.map(item => item[list.key])])
          for (const item of items) {
            await client.query(`INSERT INTO ${list.table} (profile_id,${list.columns.map(c => `"${c}"`).join(',')}) VALUES ($1,${list.columns.map((_,i) => `$${i+2}`).join(',')})
              ON CONFLICT (profile_id,${list.key}) WHERE deleted_at IS NULL DO UPDATE SET ${list.columns.map(c => `"${c}"=EXCLUDED."${c}"`).join(',')}`, [id,...list.columns.map(c => item[c])])
          }
        }
        return this.personalProfile(client)
      })
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new StoreError(409, 'Profile changed. Load the current version before saving.')
      throw error
    }
  }
  async applications() {
    return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { rows } = await client.query('SELECT a.id FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id WHERE a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY a.created_at,a.id')
      const applications: LiveApplication[] = []
      for (const row of rows) applications.push(await this.application(row.id,client))
      return { applications }
    })
  }
  async application(slug: string, query: Queryable = this.pool): Promise<LiveApplication> {
    if (query === this.pool) return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      return this.application(slug,client)
    })
    this.id(slug)
    const { rows } = await query.query(`SELECT a.*, j.company_id,j.title,j.contract_type,j.location,j.job_url,j.apply_url,j.description_md,j.description_input_kind,j.description_captured_at,j.description_resolved_url,j.description_capture_method,j.description_edited_after_capture,j.row_version AS job_revision,c.name AS company
      FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
      WHERE (a.slug=$1 OR a.id::text=$1) AND a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL`, [slug])
    if (!rows.length) throw new StoreError(404, 'Application not found')
    const a = rows[0]
    const contacts = await query.query(`SELECT c.*,ac.relationship_role,ac.is_primary FROM application_contacts ac JOIN contacts c ON c.id=ac.contact_id
      WHERE ac.application_id=$1 AND ac.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY ac.is_primary DESC,ac.created_at`, [a.id])
    const tasks = await query.query('SELECT * FROM tasks WHERE application_id=$1 AND deleted_at IS NULL ORDER BY created_at,id', [a.id])
    const events = await query.query('SELECT *, COALESCE(occurred_on, (occurred_at AT TIME ZONE $2)::date)::text AS display_date FROM application_events WHERE application_id=$1 AND deleted_at IS NULL ORDER BY sequence_number', [a.id, await this.timezone()])
    const interviews = await query.query('SELECT * FROM interviews WHERE application_id=$1 AND deleted_at IS NULL ORDER BY sequence_number', [a.id])
    const cvs = await query.query(`SELECT ac.*,v.content_md,v.version_number,v.cv_id,c.name,c.slug FROM application_cvs ac JOIN cv_versions v ON v.id=ac.cv_version_id JOIN cvs c ON c.id=v.cv_id
      WHERE ac.application_id=$1 AND ac.deleted_at IS NULL AND v.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY ac.created_at,ac.id`, [a.id])
    const tags = await query.query('SELECT t.name FROM application_tags at JOIN tags t ON t.id=at.tag_id WHERE at.application_id=$1 AND at.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY at.created_at,at.id', [a.id])
    const contact = contacts.rows.find(c => c.is_primary)
    const task = tasks.rows.find(t => t.is_next && t.status === 'pending')
    const selected = cvs.rows.find(c => c.state === 'selected') ?? cvs.rows.at(-1)
    const data = applicationSchema.parse({
      company: a.company, role: a.title, status: a.status, priority: optional(a.priority), type: optional(a.contract_type),
      location: optional(a.location), job_url: optional(a.job_url), apply_url: optional(a.apply_url), applied_at: optional(a.applied_on),
      rate: a.currency === null ? undefined : { requested: optional(a.requested_amount), minimum: optional(a.minimum_amount), currency: a.currency, period: a.rate_period, vat: optional(a.vat), basis: optional(a.rate_basis) },
      contact: contact ? { name:contact.name, role: optional(contact.relationship_role ?? contact.role), email:optional(contact.email), phone:optional(contact.phone), linkedin:optional(contact.linkedin_url) } : undefined,
      next_action: task ? { type:task.type, description:task.description, date:optional(task.due_on) } : undefined,
      cv: selected ? './cv.md' : undefined, tags:tags.rows.map(t => t.name),
      timeline: events.rows.map(e => ({ date:e.display_date, type:e.type, description:e.description })),
    })
    const documents: Record<string,string> = { 'application.md': `---\n${stringify(data)}---\n${a.notes_md}` }
    if (a.description_md !== null) documents['job-description.md'] = a.description_md
    if (selected) documents['cv.md'] = selected.content_md
    const interviewViews = await Promise.all(interviews.rows.map(async i => {
      const slug = `${String(i.sequence_number).padStart(2,'0')}-${slugify(i.kind)}`
      const paths: string[] = []
      for (const [field,name] of [['summary_md','summary.md'],['transcript_md','transcript.md'],['notes_md','notes.md']]) {
        if (i[field] !== null) { const path = `interviews/${slug}/${name}`; documents[path]=i[field]; paths.push(path) }
      }
      const participants=(await query.query('SELECT display_name AS name,role FROM interview_participants WHERE interview_id=$1 AND deleted_at IS NULL ORDER BY created_at,id',[i.id])).rows
      return { participants, id:i.id, slug, title:`${i.sequence_number} - ${i.kind}`, documents:paths, status:i.status, date:i.scheduled_on ?? i.starts_at?.toISOString(), revision:String(i.row_version) }
    }))
    return { id:a.id, jobId:a.job_id, companyId:a.company_id, slug:a.slug, data, notes:a.notes_md, documents, interviews:interviewViews, revision:String(a.row_version),
      jobRevision:String(a.job_revision), jobPostingProvenance:provenanceFromJob(a) ?? null, tasks:tasks.rows.map(t => ({ id:t.id, type:t.type, description:t.description, date:t.due_on, status:t.status, isNext:t.is_next })),
      cvHistory:cvs.rows.map(c => ({ id:c.id, versionId:c.cv_version_id, name:c.name, version:c.version_number, state:c.state, sentOn:c.sent_on, sentAt:c.sent_at?.toISOString() ?? null, content:c.content_md })),
      eventIds:events.rows.map(e => e.id) }
  }
  timezone() { return environment(this.root).APP_TIMEZONE || 'Europe/Lisbon' }
  async appendEvent(client: PoolClient, applicationId: string, entry: TimelineEntry, links: { interviewId?: string; taskId?: string; cvId?: string; from?: string; to?: string; metadata?: unknown } = {}) {
    // Caller holds the application lock, so concurrent events cannot share a sequence.
    const { rows } = await client.query('SELECT COALESCE(MAX(sequence_number),0)+1 AS next FROM application_events WHERE application_id=$1', [applicationId])
    await client.query(`INSERT INTO application_events(application_id,sequence_number,type,description,occurred_on,from_status,to_status,interview_id,task_id,application_cv_id,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [applicationId,rows[0].next,entry.type,entry.description,entry.date,links.from ?? null,links.to ?? null,links.interviewId ?? null,links.taskId ?? null,links.cvId ?? null,links.metadata ? JSON.stringify(links.metadata) : null])
  }
  private async insertApplication(client: PoolClient, data: ApplicationData, jobDescriptionMd?: string) {
    // Serialize company lookup/create without imposing an incorrect UNIQUE(name) constraint.
    await client.query('SELECT pg_advisory_xact_lock(87314002)')
    let company = (await client.query('SELECT id FROM companies WHERE name=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE',[data.company])).rows[0]
    if (!company) company = (await client.query('INSERT INTO companies(name) VALUES ($1) RETURNING id',[data.company])).rows[0]
    const description = jobDescriptionMd === undefined ? null : parseJobDescription(jobDescriptionMd)
    const job = (await client.query(`INSERT INTO jobs(company_id,title,contract_type,location,job_url,apply_url,${JOB_DESCRIPTION_COLUMNS})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[company.id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null,data.apply_url ?? null,...descriptionColumns(description,jobDescriptionMd ?? null)])).rows[0]
    const base = slugify(`${data.company} ${data.role}`)
    if (!base) throw new StoreError(400,'Company and role need letters or digits')
    let slug = base
    let index = 2
    while ((await client.query('SELECT 1 FROM applications WHERE slug=$1',[slug])).rowCount) slug = `${base}-${index++}`
    const a = (await client.query(`INSERT INTO applications(job_id,slug,status,priority,applied_on,notes_md,requested_amount,minimum_amount,currency,rate_period,vat,rate_basis)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[job.id,slug,data.status,data.priority ?? null,data.applied_at ?? null,'## Notes\n',data.rate?.requested ?? null,data.rate?.minimum ?? null,data.rate?.currency ?? null,data.rate?.period ?? null,data.rate?.vat ?? null,data.rate ? data.rate.basis ?? 'unknown' : null])).rows[0]
    await this.replaceContact(client,a.id,data.contact)
    await this.replaceTags(client,a.id,data.tags)
    await this.replaceNextAction(client,a.id,data.next_action)
    for (const entry of data.timeline) await this.appendEvent(client,a.id,entry)
    return a
  }
  async createApplication(input: CreateApplicationInput) {
    return transaction(this.pool, async client => {
      const fields = Object.fromEntries(Object.entries(input.fields).filter(([,value]) => value !== null))
      const data = applicationSchema.parse({ ...fields, status:input.applied ? 'applied' : 'interested', applied_at:input.applied ? input.date : undefined,
        timeline:[{ date:input.date,type:'created',description:'Application created' },...(input.applied ? [{ date:input.date,type:'applied',description:'Application submitted' }] : [])] })
      const jobDescription = input.jobPosting ? serializeJobDescription({ ...emptyJobDescription(), ...input.jobSections, originalText:input.jobPosting, ...this.capturedDescription(input.jobPostingCapture,data.job_url) }) : undefined
      const a = await this.insertApplication(client,data,jobDescription)
      return this.application(a.id,client)
    })
  }
  /** The capture instant is independent of `input.date`, which may be an old application date. */
  private capturedDescription(capture: JobPostingCapture | undefined, jobUrl: string | undefined): Pick<JobDescription, 'source' | 'capturedOn' | 'provenance'> {
    if (capture?.inputKind !== 'url') {
      const capturedAt = new Date().toISOString()
      return { source:jobUrl ?? '', capturedOn:dateInTimezone(capturedAt,this.timezone()), provenance:{ inputKind:'manual',capturedAt } }
    }
    const capturedAt = new Date(capture.capturedAt).toISOString()
    return { source:capture.sourceUrl, capturedOn:dateInTimezone(capturedAt,this.timezone()), provenance:{ inputKind:'url',capturedAt,resolvedUrl:capture.resolvedUrl,method:capture.method,edited:capture.edited } }
  }
  private async replaceContact(client: PoolClient, applicationId: string, contact?: ApplicationData['contact']) {
    await client.query('UPDATE application_contacts SET deleted_at=now() WHERE application_id=$1 AND is_primary AND deleted_at IS NULL',[applicationId])
    if (!contact) return
    // Creating a new contact preserves the previous identity; editing a shared person is a separate operation.
    const c = (await client.query('INSERT INTO contacts(name,role,email,phone,linkedin_url) VALUES ($1,$2,$3,$4,$5) RETURNING id',[contact.name,contact.role ?? null,contact.email ?? null,contact.phone ?? null,contact.linkedin ?? null])).rows[0]
    await client.query('INSERT INTO application_contacts(application_id,contact_id,relationship_role,is_primary) VALUES ($1,$2,$3,true)',[applicationId,c.id,contact.role ?? null])
  }
  private async replaceTags(client: PoolClient, applicationId: string, tags: string[]) {
    await client.query('UPDATE application_tags SET deleted_at=now() WHERE application_id=$1 AND deleted_at IS NULL',[applicationId])
    for (const name of new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))) {
      const tag = (await client.query(`INSERT INTO tags(name) VALUES ($1) ON CONFLICT (lower(btrim(name))) WHERE deleted_at IS NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`,[name])).rows[0]
      await client.query('INSERT INTO application_tags(application_id,tag_id) VALUES ($1,$2)',[applicationId,tag.id])
    }
  }
  private async replaceNextAction(client: PoolClient, applicationId: string, action?: ApplicationData['next_action']) {
    await client.query("UPDATE tasks SET status='cancelled',cancelled_at=now(),is_next=false WHERE application_id=$1 AND deleted_at IS NULL AND is_next",[applicationId])
    if (action) await client.query("INSERT INTO tasks(application_id,type,description,due_on,status,is_next) VALUES ($1,$2,$3,$4,'pending',true)",[applicationId,action.type,action.description,action.date ?? null])
  }
  async updateApplication(slug: string, input: { revision: string; fields: ApplicationFields; event?: TimelineEntry }) {
    return transaction(this.pool, async client => {
      const a = await this.lockedApplication(client,slug,input.revision)
      const before = await this.application(a.id,client)
      const merged: Record<string,unknown> = { ...before.data }
      for (const [key,value] of Object.entries(input.fields)) { if (value === null) delete merged[key]; else merged[key]=value }
      const data = applicationSchema.parse(merged)
      if (isDeepStrictEqual(data,before.data) && !input.event) return before
      // Editing shared company/job identities forks the opportunity for this application instead of rewriting others.
      if (data.company !== before.data.company) {
        await client.query('SELECT pg_advisory_xact_lock(87314002)')
        let company = (await client.query('SELECT id FROM companies WHERE name=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE',[data.company])).rows[0]
        if (!company) company = (await client.query('INSERT INTO companies(name) VALUES ($1) RETURNING id',[data.company])).rows[0]
        const job = (await client.query(`INSERT INTO jobs(company_id,title,contract_type,location,job_url,apply_url,${JOB_DESCRIPTION_COLUMNS})
          SELECT $2,$3,$4,$5,$6,$7,${JOB_DESCRIPTION_COLUMNS} FROM jobs WHERE id=$1 RETURNING id`,[a.job_id,company.id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null,data.apply_url ?? null])).rows[0]
        a.job_id=job.id
      } else if (!isDeepStrictEqual([data.role,data.type,data.location,data.job_url,data.apply_url],[before.data.role,before.data.type,before.data.location,before.data.job_url,before.data.apply_url])) {
        const count = await client.query('SELECT 1 FROM applications WHERE job_id=$1 AND id<>$2',[a.job_id,a.id])
        if (count.rowCount) {
          a.job_id=(await client.query(`INSERT INTO jobs(company_id,title,contract_type,location,job_url,apply_url,${JOB_DESCRIPTION_COLUMNS})
            SELECT company_id,$2,$3,$4,$5,$6,${JOB_DESCRIPTION_COLUMNS} FROM jobs WHERE id=$1 RETURNING id`,[a.job_id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null,data.apply_url ?? null])).rows[0].id
        } else await client.query('UPDATE jobs SET title=$2,contract_type=$3,location=$4,job_url=$5,apply_url=$6 WHERE id=$1',[a.job_id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null,data.apply_url ?? null])
      }
      await client.query(`UPDATE applications SET job_id=$2,priority=$3,applied_on=$4,requested_amount=$5,minimum_amount=$6,currency=$7,rate_period=$8,vat=$9,rate_basis=$10 WHERE id=$1`,[a.id,a.job_id,data.priority ?? null,data.applied_at ?? null,data.rate?.requested ?? null,data.rate?.minimum ?? null,data.rate?.currency ?? null,data.rate?.period ?? null,data.rate?.vat ?? null,data.rate ? data.rate.basis ?? 'unknown' : null])
      if (!isDeepStrictEqual([data.company,data.role,data.type,data.location,data.apply_url], [before.data.company,before.data.role,before.data.type,before.data.location,before.data.apply_url])) {
        await client.query('UPDATE application_preparations SET form_inspected=false WHERE application_id=$1 AND deleted_at IS NULL', [a.id])
      }
      if (!isDeepStrictEqual(data.contact,before.data.contact)) await this.replaceContact(client,a.id,data.contact)
      if (!isDeepStrictEqual(data.tags,before.data.tags)) await this.replaceTags(client,a.id,data.tags)
      if (!isDeepStrictEqual(data.next_action,before.data.next_action)) await this.replaceNextAction(client,a.id,data.next_action)
      if (input.event) await this.appendEvent(client,a.id,input.event)
      return this.application(a.id,client)
    })
  }
  async status(slug: string, input: { revision: string; status: Status; date: string; keepNextAction?: boolean }) {
    return transaction(this.pool, async client => {
      const a = await this.lockedApplication(client,slug,input.revision)
      if (a.status === input.status) return this.application(a.id,client)
      await client.query('UPDATE applications SET status=$2,applied_on=CASE WHEN $2=\'applied\' THEN COALESCE(applied_on,$3::date) ELSE applied_on END WHERE id=$1',[a.id,input.status,input.date])
      await this.appendEvent(client,a.id,{ date:input.date,type:'status_changed',description:`Status changed from ${a.status} to ${input.status}` },{ from:a.status,to:input.status })
      if (CLOSED_STATUSES.includes(input.status) && !input.keepNextAction) await this.replaceNextAction(client,a.id)
      return this.application(a.id,client)
    })
  }
  async deleteApplication(slug: string, input: { revision: string }) {
    return transaction(this.pool, async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      await this.appendEvent(client,a.id,{ date:todayIsoDate(),type:'deleted',description:'Application removed' })
      await client.query('UPDATE applications SET deleted_at=now() WHERE id=$1',[a.id])
      return { id:a.id,slug:a.slug }
    })
  }
  async trash() {
    return (await this.pool.query('SELECT id,slug,status,row_version AS revision,deleted_at FROM applications WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')).rows
  }
  async permanentlyDeleteApplication(slug: string, input: { revision: string }) {
    return transaction(this.pool, async client => {
      const a=await this.lockedApplication(client,slug,input.revision,true)
      // Remove references before their targets; shared CVs, jobs and contacts remain.
      await client.query('DELETE FROM application_events WHERE application_id=$1',[a.id])
      await client.query('DELETE FROM attachments WHERE application_id=$1 OR interview_id IN (SELECT id FROM interviews WHERE application_id=$1)',[a.id])
      await client.query('DELETE FROM interview_analyses WHERE interview_id IN (SELECT id FROM interviews WHERE application_id=$1)',[a.id])
      await client.query('DELETE FROM interview_participants WHERE interview_id IN (SELECT id FROM interviews WHERE application_id=$1)',[a.id])
      await client.query('DELETE FROM application_answers WHERE preparation_id IN (SELECT id FROM application_preparations WHERE application_id=$1)',[a.id])
      for (const table of ['application_preparations','interviews','tasks','application_cvs','application_contacts','application_tags']) {
        await client.query(`DELETE FROM ${table} WHERE application_id=$1`,[a.id])
      }
      await client.query('DELETE FROM import_sources WHERE entity_type=$1 AND entity_id=$2',['application',a.id])
      await client.query('DELETE FROM applications WHERE id=$1',[a.id])
      return { id:a.id,slug:a.slug }
    })
  }
  async restoreApplication(slug: string, input: { revision: string }) {
    return transaction(this.pool, async client => {
      const a=await this.lockedApplication(client,slug,input.revision,true)
      await client.query('UPDATE applications SET deleted_at=NULL WHERE id=$1',[a.id])
      await this.appendEvent(client,a.id,{ date:todayIsoDate(),type:'restored',description:'Application restored' })
      return this.application(a.id,client)
    })
  }
  async appendNote(slug: string, input: { revision: string; note: string }) {
    return transaction(this.pool, async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      await client.query("UPDATE applications SET notes_md=notes_md || CASE WHEN right(notes_md,2)=E'\\n\\n' THEN '' WHEN right(notes_md,1)=E'\\n' THEN E'\\n' ELSE E'\\n\\n' END || $2 || E'\\n' WHERE id=$1",[a.id,input.note.trim()])
      return this.application(a.id,client)
    })
  }
  async saveJobDescription(slug: string, input: { content: string; revision: string | null }) {
    return transaction(this.pool, async client => {
      const a=await this.lockedApplication(client,slug)
      const job=(await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[a.job_id])).rows[0]
      const expected=job.description_md === null ? null : String(job.row_version)
      if (expected !== input.revision) throw new StoreError(409,'Job description changed. Reload before saving.')
      const parsed=parseJobDescription(input.content)
      // Provenance comes from the stored record, never from the edited document; legacy documents are kept exactly as written.
      const provenance=provenanceFromJob(job)
      if (provenance?.inputKind==='url' && parsed.originalText!==parseJobDescription(job.description_md).originalText) provenance.edited=true
      const description={ ...parsed,provenance }
      const columns=descriptionColumns(description,provenance ? serializeJobDescription(description) : input.content)
      await client.query(`UPDATE jobs SET (${JOB_DESCRIPTION_COLUMNS})=($2,$3,$4,$5,$6,$7,$8,$9) WHERE id=$1`,[a.job_id,...columns])
      await client.query('UPDATE applications SET notes_md=notes_md WHERE id=$1',[a.id])
      return this.application(a.id,client)
    })
  }
  async cvs() {
    const { rows }=await this.pool.query("SELECT slug FROM cvs WHERE deleted_at IS NULL AND kind<>'tailored' ORDER BY slug")
    return Promise.all(rows.map(row => this.cv(row.slug)))
  }
  async cv(name: string, query: Queryable = this.pool) {
    this.id(name)
    const { rows }=await query.query(`SELECT c.*,v.content_md,v.version_number,v.derived_from_version_id FROM cvs c JOIN cv_versions v ON v.id=c.current_version_id
      WHERE (c.slug=$1 OR c.id::text=$1) AND c.deleted_at IS NULL AND v.deleted_at IS NULL`,[name])
    if (!rows.length) throw new StoreError(404,'CV not found')
    const row=rows[0]
    return { id:row.id,name:row.slug,title:row.name,kind:row.kind,content:row.content_md,revision:String(row.row_version),version:row.version_number,versionId:row.current_version_id,derivedFromVersionId:row.derived_from_version_id }
  }
  async insertCv(client: PoolClient, name: string, content: string, options: { kind?: string; derivedFromVersionId?: string; changeNote?: string } = {}) {
    this.id(name)
    const cv=(await client.query('INSERT INTO cvs(slug,name,kind) VALUES ($1,$1,$2) RETURNING id',[name,options.kind ?? (name==='master' ? 'master':'base')])).rows[0]
    const v=(await client.query('INSERT INTO cv_versions(cv_id,version_number,content_md,content_sha256,derived_from_version_id,change_note) VALUES ($1,1,$2,$3,$4,$5) RETURNING id',[cv.id,content,revision(content),options.derivedFromVersionId ?? null,options.changeNote ?? null])).rows[0]
    await client.query('UPDATE cvs SET current_version_id=$2 WHERE id=$1',[cv.id,v.id])
    return this.cv(cv.id,client)
  }
  async saveCv(name: string, content: string, expected: string | null, options: { derivedFromVersionId?: string; changeNote?: string } = {}) {
    return transaction(this.pool,async client => {
      if (expected === null) return this.insertCv(client,name,content,options)
      const c=(await client.query('SELECT * FROM cvs WHERE slug=$1 AND deleted_at IS NULL FOR UPDATE',[this.id(name)])).rows[0]
      if (!c) throw new StoreError(404,'CV not found')
      if (String(c.row_version)!==expected) throw new StoreError(409,'CV changed. Reload before saving.')
      const current=await this.cv(c.id,client)
      if (current.content===content && !options.derivedFromVersionId) return current
      const number=(await client.query('SELECT COALESCE(MAX(version_number),0)+1 AS next FROM cv_versions WHERE cv_id=$1',[c.id])).rows[0].next
      const v=(await client.query('INSERT INTO cv_versions(cv_id,version_number,content_md,content_sha256,derived_from_version_id,change_note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[c.id,number,content,revision(content),options.derivedFromVersionId ?? current.derivedFromVersionId,options.changeNote ?? null])).rows[0]
      await client.query('UPDATE cvs SET current_version_id=$2 WHERE id=$1',[c.id,v.id])
      return this.cv(c.id,client)
    })
  }
  async cvVersions(name: string) {
    const cv=await this.cv(name)
    return (await this.pool.query('SELECT id,version_number AS version,content_md AS content,derived_from_version_id,change_note,created_at FROM cv_versions WHERE cv_id=$1 AND deleted_at IS NULL ORDER BY version_number DESC',[cv.id])).rows
  }
  async attachCv(slug: string, input: { name: string; revision: string; sourceRevision: string; cvRevision: string | null; allowHistoricalEdit?: boolean }) {
    return transaction(this.pool, async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      await client.query('SELECT id FROM cvs WHERE slug=$1 AND deleted_at IS NULL FOR UPDATE',[input.name])
      const source=await this.cv(input.name,client)
      if (source.revision!==input.sourceRevision) throw new StoreError(409,'Source CV changed. Reload before selecting.')
      const old=(await client.query('SELECT * FROM application_cvs WHERE application_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC',[a.id])).rows
      const displayed=old.find(c=>c.state==='selected') ?? old[0]
      if ((displayed?.id ?? null)!==input.cvRevision) throw new StoreError(409,'Selected CV changed. Reload before selecting.')
      await client.query("UPDATE application_cvs SET deleted_at=now() WHERE application_id=$1 AND state='selected' AND deleted_at IS NULL",[a.id])
      // The immutable source version is already a snapshot; customization creates a tailored CV separately.
      const selected=(await client.query("INSERT INTO application_cvs(application_id,cv_version_id,state) VALUES ($1,$2,'selected') RETURNING id",[a.id,source.versionId])).rows[0]
      await this.appendEvent(client,a.id,{ date:todayIsoDate(),type:'cv_selected',description:`Selected ${source.name} v${source.version}` },{ cvId:selected.id })
      await client.query('UPDATE applications SET notes_md=notes_md WHERE id=$1',[a.id])
      return this.application(a.id,client)
    })
  }
  async sendCv(slug: string, input: { revision: string; versionId: string; date: string; channel?: string }) {
    return transaction(this.pool,async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      const selected=(await client.query("SELECT id FROM application_cvs WHERE application_id=$1 AND cv_version_id=$2 AND state='selected' AND deleted_at IS NULL",[a.id,input.versionId])).rows[0]
      if (!selected) throw new StoreError(409,'Select this CV version before recording its submission')
      const sent=(await client.query("INSERT INTO application_cvs(application_id,cv_version_id,state,sent_on,channel) VALUES ($1,$2,'sent',$3,$4) RETURNING id",[a.id,input.versionId,input.date,input.channel ?? null])).rows[0]
      await this.appendEvent(client,a.id,{ date:input.date,type:'cv_sent',description:'CV submission recorded' },{ cvId:sent.id })
      await client.query('UPDATE applications SET notes_md=notes_md WHERE id=$1',[a.id])
      return this.application(a.id,client)
    })
  }
  async completeTask(slug: string, input: { revision: string; taskId: string }) {
    return transaction(this.pool,async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      const task=(await client.query("UPDATE tasks SET status='completed',completed_at=now(),is_next=false WHERE id=$1 AND application_id=$2 AND deleted_at IS NULL AND status='pending' RETURNING *",[input.taskId,a.id])).rows[0]
      if (!task) throw new StoreError(404,'Pending task not found')
      await this.appendEvent(client,a.id,{ date:todayIsoDate(),type:'task_completed',description:task.description },{ taskId:task.id })
      await client.query('UPDATE applications SET notes_md=notes_md WHERE id=$1',[a.id])
      return this.application(a.id,client)
    })
  }
  async messages() {
    const { rows }=await this.pool.query('SELECT id,slug,title,content,row_version AS revision FROM message_templates WHERE deleted_at IS NULL ORDER BY title')
    return { messages:rows }
  }
  async createMessage(input: { title: string; content: string }) {
    const slug=slugify(input.title)
    if (!slug) throw new StoreError(400,'Title needs at least one letter or digit')
    const { rows }=await this.pool.query('INSERT INTO message_templates(slug,title,content) VALUES ($1,$2,$3) RETURNING id,slug,title,content,row_version AS revision',[slug,input.title.trim(),input.content.trim()])
    return rows[0]
  }
  async saveMessage(slug: string,input: { title: string; content: string; revision: string }) {
    const { rows }=await this.pool.query('UPDATE message_templates SET title=$2,content=$3 WHERE slug=$1 AND row_version=$4 AND deleted_at IS NULL RETURNING id,slug,title,content,row_version AS revision',[this.id(slug),input.title.trim(),input.content.trim(),input.revision])
    if (!rows.length) throw new StoreError(409,'Message missing or changed. Reload before saving.')
    return rows[0]
  }
  async deleteMessage(slug: string,input: { revision: string }) {
    const result=await this.pool.query('UPDATE message_templates SET deleted_at=now() WHERE slug=$1 AND row_version=$2 AND deleted_at IS NULL',[this.id(slug),input.revision])
    if (!result.rowCount) throw new StoreError(409,'Message missing or changed. Reload before deleting.')
    return { slug }
  }
  async restoreMessage(slug: string,input: { revision: string }) {
    const { rows }=await this.pool.query('UPDATE message_templates SET deleted_at=NULL WHERE slug=$1 AND row_version=$2 AND deleted_at IS NOT NULL RETURNING id,slug,title,content,row_version AS revision',[this.id(slug),input.revision])
    if (!rows.length) throw new StoreError(409,'Removed message missing or changed')
    return rows[0]
  }
  async createInterview(slug: string,input: { revision: string; kind: string; date?: string; startsAt?: string; endsAt?: string; timezone?: string; participants?: { name: string; role?: string }[]; notes?: string; transcript?: string; summary?: string; status: string }) {
    return transaction(this.pool,async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      const number=(await client.query('SELECT COALESCE(MAX(sequence_number),0)+1 AS next FROM interviews WHERE application_id=$1',[a.id])).rows[0].next
      const i=(await client.query(`INSERT INTO interviews(application_id,sequence_number,kind,status,scheduled_on,starts_at,ends_at,timezone,notes_md,transcript_md,summary_md)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[a.id,number,input.kind,input.status,input.date ?? null,input.startsAt ?? null,input.endsAt ?? null,input.timezone ?? null,input.notes ?? null,input.transcript ?? null,input.summary ?? null])).rows[0]
      for (const participant of input.participants ?? []) await client.query('INSERT INTO interview_participants(interview_id,display_name,role) VALUES ($1,$2,$3)',[i.id,participant.name,participant.role ?? null])
      const type=input.status==='scheduled' ? 'interview_scheduled' : input.status==='completed' ? 'interview_completed' : 'interview_recorded'
      await this.appendEvent(client,a.id,{ date:input.date ?? todayIsoDate(),type,description:`${input.kind} interview ${input.status}` },{ interviewId:i.id })
      await client.query('UPDATE applications SET notes_md=notes_md WHERE id=$1',[a.id])
      return this.application(a.id,client)
    })
  }
  async customizeCv(slug: string,input: { revision: string; content: string; sourceVersionId: string }) {
    return transaction(this.pool,async client => {
      const a=await this.lockedApplication(client,slug,input.revision)
      const cv=await this.insertCv(client,`${a.slug}-cv-${randomUUID().slice(0,8)}`,input.content,{kind:'tailored',derivedFromVersionId:input.sourceVersionId})
      await client.query("UPDATE application_cvs SET deleted_at=now() WHERE application_id=$1 AND state='selected' AND deleted_at IS NULL",[a.id])
      const selected=(await client.query("INSERT INTO application_cvs(application_id,cv_version_id,state) VALUES ($1,$2,'selected') RETURNING id",[a.id,cv.versionId])).rows[0]
      await this.appendEvent(client,a.id,{ date:todayIsoDate(),type:'cv_customized',description:'Customized CV selected' },{cvId:selected.id})
      await client.query('UPDATE applications SET notes_md=notes_md WHERE id=$1',[a.id])
      return this.application(a.id,client)
    })
  }
  async knowledge(query: Queryable = this.pool, id: string | null = null): Promise<{ entries: KnowledgeEntry[] }> {
    const { rows }=await query.query(`SELECT e.*,COALESCE((SELECT array_agg(a.question ORDER BY a.question) FROM knowledge_question_aliases a WHERE a.entry_id=e.id AND a.deleted_at IS NULL),'{}') AS aliases
      FROM knowledge_entries e WHERE e.deleted_at IS NULL AND ($1::uuid IS NULL OR e.id=$1) ORDER BY e.concept,e.created_at,e.id`,[id])
    return { entries:rows.map(row => ({ id:row.id,revision:String(row.row_version),concept:row.concept,question:row.question,language:row.language,category:row.category,
      answer:answerValueSchema.parse(row.answer),context:row.context,aliases:row.aliases,confirmed:row.confirmed_at!==null,origin:row.origin,confirmedAt:row.confirmed_at?.toISOString() ?? null })) }
  }
  async knowledgeEntry(id: string, query: Queryable = this.pool) {
    const entry = (await this.knowledge(query, id)).entries[0]
    if (!entry) throw new StoreError(404, 'Knowledge entry not found')
    return entry
  }
  async patchKnowledge(id: string, input: unknown) {
    const patch = knowledgeFieldsSchema.partial().extend({ revision: saveKnowledgeSchema.shape.revision }).parse(input)
    return transaction(this.pool, async client => {
      await client.query('SELECT id FROM knowledge_entries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id])
      const current = await this.knowledgeEntry(id, client)
      const { id: _id, revision: _revision, origin: _origin, confirmedAt: _confirmedAt, ...existing } = current
      const { revision: _expected, ...changes } = patch
      const fields = knowledgeFieldsSchema.parse({ ...existing, ...changes })
      return this.writeKnowledge(client, id, fields, patch.revision)
    })
  }
  private async writeKnowledge(client: PoolClient, id: string | null, fields: KnowledgeFields, expected?: string) {
    const values=[fields.concept,fields.question,fields.language,fields.category,JSON.stringify(fields.answer),JSON.stringify(fields.context),contextKey(fields.context),fields.confirmed]
    const saved=await (id===null
      ? client.query('INSERT INTO knowledge_entries(concept,question,language,category,answer,context,context_key,confirmed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8 THEN now() END) RETURNING id',values)
      : client.query('UPDATE knowledge_entries SET concept=$1,question=$2,language=$3,category=$4,answer=$5,context=$6,context_key=$7,confirmed_at=CASE WHEN $8 THEN now() END WHERE id=$9 AND row_version=$10 AND deleted_at IS NULL RETURNING id',[...values,id,expected])
    ).catch(error => { throw error.code==='23505' ? new StoreError(409,'An active entry already exists for this concept, language and context.') : error })
    if (!saved.rows.length) throw new StoreError(409,'Entry missing or changed. Reload before saving.')
    const entryId=saved.rows[0].id
    await client.query('UPDATE knowledge_question_aliases SET deleted_at=clock_timestamp() WHERE entry_id=$1 AND deleted_at IS NULL AND NOT (normalized_question=ANY($2::text[]))',[entryId,fields.aliases.map(normalizeText)])
    for (const alias of fields.aliases) await client.query(`INSERT INTO knowledge_question_aliases(entry_id,question,normalized_question) VALUES ($1,$2,$3)
      ON CONFLICT (entry_id,normalized_question) WHERE deleted_at IS NULL DO UPDATE SET question=EXCLUDED.question`,[entryId,alias,normalizeText(alias)])
    return (await this.knowledge(client,entryId)).entries[0]
  }
  async saveKnowledge(id: string | null, input: KnowledgeFields & { revision?: string }) {
    const { revision:expected,...fields }=input
    return transaction(this.pool,client => this.writeKnowledge(client,id,fields,expected))
  }
  async deleteKnowledge(id: string, input: { revision: string }) {
    const result=await this.pool.query('UPDATE knowledge_entries SET deleted_at=now() WHERE id=$1 AND row_version=$2 AND deleted_at IS NULL',[id,input.revision])
    if (!result.rowCount) throw new StoreError(409,'Entry missing or changed. Reload before deleting.')
    return { id }
  }
  private async preparationView(client: PoolClient, id: string): Promise<{ preparation: Preparation }> {
    const p=(await client.query(`SELECT p.*,v.version_number,c.slug AS cv_name FROM application_preparations p
      LEFT JOIN cv_versions v ON v.id=p.cv_version_id LEFT JOIN cvs c ON c.id=v.cv_id WHERE p.id=$1`,[id])).rows[0]
    const answers=await client.query('SELECT * FROM application_answers WHERE preparation_id=$1 AND deleted_at IS NULL ORDER BY created_at,id',[id])
    return { preparation:{ id:p.id,applicationId:p.application_id,revision:String(p.row_version),country:p.country,language:p.language,cvRequired:p.cv_required,
      cv:p.cv_version_id ? { versionId:p.cv_version_id,name:p.cv_name,version:p.version_number } : null,formInspected:p.form_inspected,answers:answers.rows.map(answerView) } }
  }
  async preparation(slug: string): Promise<{ preparation: Preparation | null }> {
    this.id(slug)
    return transaction(this.pool,async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { rows }=await client.query(`SELECT p.id FROM application_preparations p JOIN applications a ON a.id=p.application_id JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
        WHERE (a.slug=$1 OR a.id::text=$1) AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL`,[slug])
      return rows.length ? this.preparationView(client,rows[0].id) : { preparation:null }
    })
  }
  async startPreparation(slug: string) {
    return transaction(this.pool,async client => {
      // The application lock makes a repeated or concurrent start return the same preparation.
      const a=await this.lockedApplication(client,slug)
      const existing=(await client.query('SELECT id FROM application_preparations WHERE application_id=$1 AND deleted_at IS NULL',[a.id])).rows[0]
        ?? (await client.query('INSERT INTO application_preparations(application_id) VALUES ($1) RETURNING id',[a.id])).rows[0]
      return this.preparationView(client,existing.id)
    })
  }
  private async lockedPreparation(client: PoolClient, id: string, expected: string) {
    const { rows }=await client.query(`SELECT p.*,a.job_id,j.company_id,j.location,j.contract_type FROM application_preparations p
      JOIN applications a ON a.id=p.application_id JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
      WHERE p.id=$1 AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL FOR UPDATE OF p`,[id])
    if (!rows.length) throw new StoreError(404,'Preparation not found')
    if (String(rows[0].row_version)!==expected) throw new StoreError(409,'Preparation changed. Reload before saving.')
    return rows[0]
  }
  /** Every answer change is a new preparation revision. */
  private async revisedPreparation(client: PoolClient, id: string) {
    await client.query('UPDATE application_preparations SET updated_at=updated_at,form_inspected=false WHERE id=$1',[id])
    return this.preparationView(client,id)
  }
  async updatePreparation(id: string, input: { revision: string; country: string | null; language: string; cvRequired: boolean }) {
    return transaction(this.pool,async client => {
      const p=await this.lockedPreparation(client,id,input.revision)
      await client.query('UPDATE application_preparations SET country=$2,language=$3,cv_required=$4,form_inspected=false WHERE id=$1',[id,input.country,input.language,input.cvRequired])
      if (p.country!==input.country || p.language!==input.language) {
        await client.query(`UPDATE application_answers SET approval='pending',approved_at=NULL,review_reason='The application context changed. Review this answer.'
          WHERE preparation_id=$1 AND deleted_at IS NULL AND source IN ('PROFILE','KNOWLEDGE_BASE')`,[id])
      }
      return this.preparationView(client,id)
    })
  }
  async saveJobApplyUrl(slug: string, applyUrl: string | null) {
    this.id(slug)
    return transaction(this.pool, async client => {
      const job = (await client.query(`SELECT j.id FROM jobs j WHERE j.deleted_at IS NULL AND
        (j.id::text=$1 OR EXISTS(SELECT 1 FROM applications a WHERE a.job_id=j.id AND a.slug=$1 AND a.deleted_at IS NULL))`, [slug])).rows[0]
      if (!job) throw new StoreError(404, 'Job not found')
      // Match the application-first lock order used by form submission.
      await client.query('SELECT id FROM applications WHERE job_id=$1 ORDER BY id FOR UPDATE', [job.id])
      const updated = (await client.query(`UPDATE jobs SET apply_url=$2 WHERE id=$1 AND deleted_at IS NULL
        RETURNING id,apply_url,row_version`, [job.id, applyUrl])).rows[0]
      if (!updated) throw new StoreError(404, 'Job not found')
      await client.query(`UPDATE application_preparations SET form_inspected=false WHERE deleted_at IS NULL
        AND application_id IN (SELECT id FROM applications WHERE job_id=$1)`, [job.id])
      return { id: updated.id, apply_url: updated.apply_url, revision: String(updated.row_version) }
    })
  }
  async assertFormSessionOwner(slug: string, applicationId: string) {
    this.id(slug)
    const result = await this.pool.query('SELECT id FROM applications WHERE id=$2 AND (slug=$1 OR id::text=$1)', [slug, applicationId])
    if (!result.rowCount) throw new StoreError(409, 'Form session belongs to a different application')
  }
  async formContext(slug: string) {
    this.id(slug)
    return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = (await client.query(`SELECT a.id AS application_id,a.row_version AS application_revision,
        j.id AS job_id,j.row_version AS job_revision,j.apply_url,p.id AS preparation_id,p.row_version AS preparation_revision,
        p.cv_version_id,p.cv_required,v.content_md
        FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
        JOIN application_preparations p ON p.application_id=a.id AND p.deleted_at IS NULL
        LEFT JOIN cv_versions v ON v.id=p.cv_version_id AND v.deleted_at IS NULL
        LEFT JOIN cvs cv ON cv.id=v.cv_id AND cv.deleted_at IS NULL
        WHERE (a.slug=$1 OR a.id::text=$1) AND a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL
        AND (p.cv_version_id IS NULL OR cv.id IS NOT NULL)`, [slug])).rows[0]
      if (!row) throw new StoreError(404, 'Application preparation not found')
      if (!row.apply_url) throw new StoreError(400, 'Save an application URL before inspecting the form')
      if (row.cv_required && !row.cv_version_id) throw new StoreError(400, 'Select a CV before inspecting the form')
      const view = await this.preparationView(client, row.preparation_id)
      const snapshot: FormSnapshot = { applicationId: row.application_id, applicationRevision: String(row.application_revision),
        preparationId: row.preparation_id, preparationRevision: String(row.preparation_revision),
        jobId: row.job_id, jobRevision: String(row.job_revision), applyUrl: row.apply_url, cvVersionId: row.cv_version_id }
      return { snapshot, answers: view.preparation.answers.filter(answer => answer.approval === 'accepted' && answer.answer), cvContent: row.content_md as string | null }
    })
  }
  private async lockFormSnapshot(client: PoolClient, snapshot: FormSnapshot, slug = snapshot.applicationId) {
    const application = await this.lockedApplication(client, slug, snapshot.applicationRevision)
    if (application.id !== snapshot.applicationId || application.job_id !== snapshot.jobId) throw new StoreError(409, 'Form session belongs to a different application')
    const preparation = await this.lockedPreparation(client, snapshot.preparationId, snapshot.preparationRevision)
    if (preparation.application_id !== application.id || preparation.cv_version_id !== snapshot.cvVersionId) throw new StoreError(409, 'Selected CV changed. Inspect the form again.')
    const job = (await client.query('SELECT row_version,apply_url FROM jobs WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [snapshot.jobId])).rows[0]
    if (!job || String(job.row_version) !== snapshot.jobRevision || job.apply_url !== snapshot.applyUrl) throw new StoreError(409, 'Application URL or job changed. Inspect the form again.')
    return application
  }
  async markFormInspected(snapshot: FormSnapshot, inspected: boolean) {
    return transaction(this.pool, async client => {
      await this.lockFormSnapshot(client, snapshot)
      const row = (await client.query('UPDATE application_preparations SET form_inspected=$2 WHERE id=$1 RETURNING row_version', [snapshot.preparationId, inspected])).rows[0]
      return { ...snapshot, preparationRevision: String(row.row_version) }
    })
  }
  async recordFormSubmission(slug: string, snapshot: FormSnapshot, sessionId: string, submit: () => Promise<void>) {
    return transaction(this.pool, async client => {
      const owner = await this.lockedApplication(client, slug)
      if (owner.id !== snapshot.applicationId) throw new StoreError(409, 'Form session belongs to a different application')
      const recorded = await client.query("SELECT id FROM application_events WHERE application_id=$1 AND type='applied' AND metadata->>'formSessionId'=$2", [owner.id, sessionId])
      if (recorded.rowCount) return
      const application = await this.lockFormSnapshot(client, snapshot, slug)
      if (snapshot.cvVersionId) {
        const source = await client.query(`SELECT v.id FROM cv_versions v JOIN cvs c ON c.id=v.cv_id WHERE v.id=$1
          AND v.deleted_at IS NULL AND c.deleted_at IS NULL FOR SHARE OF v,c`, [snapshot.cvVersionId])
        if (!source.rowCount) throw new StoreError(409, 'Selected CV is no longer available')
      }
      await submit()
      const date = todayIsoDate()
      let cvId: string | undefined
      if (snapshot.cvVersionId) {
        cvId = (await client.query("INSERT INTO application_cvs(application_id,cv_version_id,state,sent_on,channel) VALUES ($1,$2,'sent',$3,$4) RETURNING id", [application.id, snapshot.cvVersionId, date, snapshot.applyUrl])).rows[0].id
      }
      await client.query("UPDATE applications SET status='applied',applied_on=$2 WHERE id=$1", [application.id, date])
      await this.appendEvent(client, application.id, { date, type: 'applied', description: 'Application submitted through the application form' },
        { cvId, from: application.status, to: 'applied', metadata: { formSessionId: sessionId, channel: snapshot.applyUrl } })
    })
  }
  async adaptationContext(slug: string, cvVersionId: string) {
    this.id(slug)
    return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const row = (await client.query(`SELECT a.id AS application_id,a.slug,a.row_version AS application_revision,
        j.id AS job_id,j.row_version AS job_revision,j.title AS role,j.description_md,c.name AS company,
        p.id AS preparation_id,p.row_version AS preparation_revision
        FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id
        JOIN application_preparations p ON p.application_id=a.id AND p.deleted_at IS NULL
        WHERE (a.slug=$1 OR a.id::text=$1) AND a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL`, [slug])).rows[0]
      if (!row) throw new StoreError(404, 'Application preparation not found')
      if (!row.description_md?.trim()) throw new StoreError(400, 'A job description is required to adapt the CV')
      const version = (await client.query(`SELECT v.content_md FROM cv_versions v JOIN cvs c ON c.id=v.cv_id
        WHERE v.id=$1 AND v.deleted_at IS NULL AND c.deleted_at IS NULL`, [cvVersionId])).rows[0]
      if (!version) throw new StoreError(404, 'CV version not found')
      const { profile } = await this.personalProfile(client)
      return { applicationId: row.application_id as string, applicationRevision: String(row.application_revision),
        jobId: row.job_id as string, jobRevision: String(row.job_revision), preparationId: row.preparation_id as string,
        preparationRevision: String(row.preparation_revision), cvVersionId, cvContent: version.content_md as string,
        jobDescription: row.description_md as string, role: row.role as string, company: row.company as string, profile }
    })
  }
  async saveAdaptedPreparationCv(context: Awaited<ReturnType<PostgresStore['adaptationContext']>>, content: string) {
    if (!content.trim() || content.length > 1_000_000) throw new StoreError(400, 'Invalid adapted CV content')
    return transaction(this.pool, async client => {
      const application = await this.lockedApplication(client, context.applicationId, context.applicationRevision)
      const preparation = await this.lockedPreparation(client, context.preparationId, context.preparationRevision)
      if (application.job_id !== context.jobId || preparation.application_id !== application.id) throw new StoreError(409, 'Application changed during CV adaptation')
      const job = (await client.query('SELECT row_version FROM jobs WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [context.jobId])).rows[0]
      if (!job || String(job.row_version) !== context.jobRevision) throw new StoreError(409, 'Job description changed during CV adaptation')
      const source = await client.query(`SELECT v.id FROM cv_versions v JOIN cvs c ON c.id=v.cv_id
        WHERE v.id=$1 AND v.deleted_at IS NULL AND c.deleted_at IS NULL FOR SHARE OF v,c`, [context.cvVersionId])
      if (!source.rowCount) throw new StoreError(404, 'CV version not found')
      const cv = await this.insertCv(client, `${application.slug}-ats-${randomUUID()}`, content, {
        kind: 'tailored', derivedFromVersionId: context.cvVersionId, changeNote: `ATS: ${context.role} at ${context.company}`,
      })
      await client.query('UPDATE application_preparations SET cv_version_id=$2,form_inspected=false WHERE id=$1', [context.preparationId, cv.versionId])
      return { versionId: cv.versionId, content: cv.content }
    })
  }
  async selectPreparationCv(id: string, input: { revision: string; cvVersionId: string }) {
    return transaction(this.pool,async client => {
      await this.lockedPreparation(client,id,input.revision)
      const version=await client.query('SELECT 1 FROM cv_versions v JOIN cvs c ON c.id=v.cv_id WHERE v.id=$1 AND v.deleted_at IS NULL AND c.deleted_at IS NULL',[input.cvVersionId])
      if (!version.rowCount) throw new StoreError(404,'CV version not found')
      await client.query('UPDATE application_preparations SET cv_version_id=$2,form_inspected=false WHERE id=$1',[id,input.cvVersionId])
      return this.preparationView(client,id)
    })
  }
  async addPreparationAnswer(id: string, input: Requirement & { revision: string }) {
    return transaction(this.pool,async client => {
      await this.lockedPreparation(client,id,input.revision)
      await client.query('INSERT INTO application_answers(preparation_id,question,concept,answer_type,options,required) VALUES ($1,$2,$3,$4,$5,$6)',[id,input.question,input.concept,input.type,JSON.stringify(input.options),input.required])
      return this.revisedPreparation(client,id)
    })
  }
  async patchApplicationPreparationAnswer(applicationId: string, answerId: string, input: unknown) {
    return this.writePreparationAnswer(applicationId, answerId, input, true)
  }
  async savePreparationAnswer(id: string, answerId: string, input: SaveAnswer) {
    return this.writePreparationAnswer(id, answerId, input, false)
  }
  private async writePreparationAnswer(id: string, answerId: string, raw: unknown, byApplication: boolean) {
    return transaction(this.pool,async client => {
      const patch = z.strictObject(saveAnswerSchema.shape).partial().required({ revision: true }).parse(raw)
      if (byApplication) {
        const application = await this.lockedApplication(client, id)
        const preparation = (await client.query('SELECT id FROM application_preparations WHERE application_id=$1 AND deleted_at IS NULL', [application.id])).rows[0]
        if (!preparation) throw new StoreError(404, 'Preparation not found')
        id = preparation.id
      }
      const p=await this.lockedPreparation(client,id,patch.revision)
      const current=(await client.query('SELECT * FROM application_answers WHERE id=$1 AND preparation_id=$2 AND deleted_at IS NULL',[answerId,id])).rows[0]
      if (!current) throw new StoreError(404,'Question not found')
      const view = answerView(current)
      const input = saveAnswerSchema.parse({ question: view.question, concept: view.concept, type: view.type, options: view.options, required: view.required, answer: view.answer, approval: view.approval, ...patch })
      if (input.answer && !answerFits(input,input.answer)) throw new StoreError(400,'The answer does not fit this field type or its options')
      const accepted=input.approval==='accepted'
      if (accepted && !input.answer) throw new StoreError(400,'Only an answer can be accepted')
      if (input.remember && !accepted) throw new StoreError(400,'Accept the answer before remembering it')
      const edited=!isDeepStrictEqual(input.answer,answerView(current).answer)
      // A typed value replaces the proposal and its provenance; reviewing a proposal keeps where it came from.
      const provenance=edited ? [input.answer ? 'USER':'UNKNOWN',input.answer ? 'VERIFIED':'UNKNOWN',null,null]
        : [current.source,current.confidence,current.evidence && JSON.stringify(current.evidence),accepted ? null : current.review_reason]
      const approvedAt=accepted ? (!edited && current.approved_at) || new Date() : null
      await client.query(`UPDATE application_answers SET question=$2,concept=$3,answer_type=$4,options=$5,required=$6,answer=$7,source=$8,confidence=$9,evidence=$10,review_reason=$11,approval=$12,approved_at=$13 WHERE id=$1`,
        [answerId,input.question,input.concept,input.type,JSON.stringify(input.options),input.required,input.answer && JSON.stringify(input.answer),...provenance,input.approval,approvedAt])
      if (input.remember) {
        await this.writeKnowledge(client,null,{ concept:input.remember.concept,question:input.question,language:p.language,category:input.remember.category,answer:input.answer!,
          context:scopedContext(input.remember.scopes,resolutionContext(p)),aliases:[],confirmed:true })
      }
      return this.revisedPreparation(client,id)
    })
  }
  async deletePreparationAnswer(id: string, answerId: string, input: { revision: string }) {
    return transaction(this.pool,async client => {
      await this.lockedPreparation(client,id,input.revision)
      const removed=await client.query('UPDATE application_answers SET deleted_at=now() WHERE id=$1 AND preparation_id=$2 AND deleted_at IS NULL',[answerId,id])
      if (!removed.rowCount) throw new StoreError(404,'Question not found')
      return this.revisedPreparation(client,id)
    })
  }
  async resolvePreparation(id: string, input: { revision: string }) {
    return transaction(this.pool,async client => {
      const p=await this.lockedPreparation(client,id,input.revision)
      const { profile }=await this.personalProfile(client)
      const { entries }=await this.knowledge(client)
      // Typed and reviewed answers are the user's decision; only open proposals are recomputed.
      const open=await client.query("SELECT * FROM application_answers WHERE preparation_id=$1 AND deleted_at IS NULL AND approval='pending' AND source<>'USER'",[id])
      for (const row of open.rows) {
        const resolved=resolveAnswer(answerView(row),resolutionContext(p),profile,entries)
        await client.query("UPDATE application_answers SET answer=$2,source=$3,confidence=$4,evidence=$5,review_reason=$6,approval=$7,approved_at=CASE WHEN $7='accepted' THEN now() END WHERE id=$1",
          [row.id,resolved.answer && JSON.stringify(resolved.answer),resolved.source,resolved.confidence,resolved.evidence && JSON.stringify(resolved.evidence),resolved.reviewReason,resolved.approval])
      }
      return this.revisedPreparation(client,id)
    })
  }
}
type Row = Record<string, any>
function answerView(row: Row): PreparationAnswer {
  return { id:row.id,question:row.question,concept:row.concept,type:row.answer_type,options:row.options,required:row.required,
    answer:row.answer===null ? null : answerValueSchema.parse(row.answer),source:row.source,confidence:row.confidence,evidence:row.evidence,reviewReason:row.review_reason,
    approval:row.approval,approvedAt:row.approved_at?.toISOString() ?? null }
}
function resolutionContext(preparation: Row): ResolutionContext {
  return { country:preparation.country,language:preparation.language,location:preparation.location,contractType:preparation.contract_type,
    companyId:preparation.company_id,jobId:preparation.job_id,applicationId:preparation.application_id }
}
function scopedContext(scopes: Restriction['type'][], context: ResolutionContext) {
  const values=contextValues(context)
  return [...new Set(scopes)].map(type => {
    if (!values[type]) throw new StoreError(400,`This application has no ${type.toLowerCase().replace('_',' ')} to limit the answer to`)
    return { type,value:values[type] } as Restriction
  })
}
