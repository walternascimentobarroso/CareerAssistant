import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { isDeepStrictEqual } from 'node:util'
import { stringify } from 'yaml'
import { Store, StoreError, revision, type ApplicationFields } from './store.ts'
import { transaction, environment } from './db/connection.ts'
import { applicationSchema, isoDate, type ApplicationData, type TimelineEntry } from '../dashboard/src/domain/schema.ts'
import { slugify, todayIsoDate, setPersonalTimezone } from '../dashboard/src/domain/format.ts'
import { CLOSED_STATUSES, type Status } from '../dashboard/src/domain/constants.ts'
import { emptyJobDescription, parseJobDescription, serializeJobDescription, type JobDescription } from '../dashboard/src/domain/jobDescription.ts'
import type { LiveApplication } from '../dashboard/src/data/loadApplications.tsx'

type Queryable = Pool | PoolClient
export type CreateApplicationInput = { fields: ApplicationFields; applied: boolean; date: string; jobPosting?: string; jobSections?: Partial<Pick<JobDescription, 'keyRequirements' | 'niceToHave' | 'technologies'>> }
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const optional = <T>(value: T | null): T | undefined => value === null ? undefined : value

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
    const { rows } = await query.query(`SELECT a.*, j.title,j.contract_type,j.location,j.job_url,j.description_md,j.row_version AS job_revision,c.name AS company
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
      location: optional(a.location), job_url: optional(a.job_url), applied_at: optional(a.applied_on),
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
    return { id:a.id, jobId:a.job_id, slug:a.slug, data, notes:a.notes_md, documents, interviews:interviewViews, revision:String(a.row_version),
      jobRevision:String(a.job_revision), tasks:tasks.rows.map(t => ({ id:t.id, type:t.type, description:t.description, date:t.due_on, status:t.status, isNext:t.is_next })),
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
    const job = (await client.query(`INSERT INTO jobs(company_id,title,contract_type,location,job_url,description_md,description_source,description_captured_on)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[company.id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null,jobDescriptionMd ?? null,description?.source || null,description?.capturedOn && isoDate.safeParse(description.capturedOn).success ? description.capturedOn : null])).rows[0]
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
      const jobDescription = input.jobPosting ? serializeJobDescription({ ...emptyJobDescription(), ...input.jobSections, originalText:input.jobPosting, source:data.job_url ?? '', capturedOn:input.date }) : undefined
      const a = await this.insertApplication(client,data,jobDescription)
      return this.application(a.id,client)
    })
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
        const job = (await client.query(`INSERT INTO jobs(company_id,title,contract_type,location,job_url,description_md,description_source,description_captured_on)
          SELECT $2,$3,$4,$5,$6,description_md,description_source,description_captured_on FROM jobs WHERE id=$1 RETURNING id`,[a.job_id,company.id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null])).rows[0]
        a.job_id=job.id
      } else if (!isDeepStrictEqual([data.role,data.type,data.location,data.job_url],[before.data.role,before.data.type,before.data.location,before.data.job_url])) {
        const count = await client.query('SELECT 1 FROM applications WHERE job_id=$1 AND id<>$2',[a.job_id,a.id])
        if (count.rowCount) {
          a.job_id=(await client.query(`INSERT INTO jobs(company_id,title,contract_type,location,job_url,description_md,description_source,description_captured_on)
            SELECT company_id,$2,$3,$4,$5,description_md,description_source,description_captured_on FROM jobs WHERE id=$1 RETURNING id`,[a.job_id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null])).rows[0].id
        } else await client.query('UPDATE jobs SET title=$2,contract_type=$3,location=$4,job_url=$5 WHERE id=$1',[a.job_id,data.role,data.type ?? null,data.location ?? null,data.job_url ?? null])
      }
      await client.query(`UPDATE applications SET job_id=$2,priority=$3,applied_on=$4,requested_amount=$5,minimum_amount=$6,currency=$7,rate_period=$8,vat=$9,rate_basis=$10 WHERE id=$1`,[a.id,a.job_id,data.priority ?? null,data.applied_at ?? null,data.rate?.requested ?? null,data.rate?.minimum ?? null,data.rate?.currency ?? null,data.rate?.period ?? null,data.rate?.vat ?? null,data.rate ? data.rate.basis ?? 'unknown' : null])
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
      for (const table of ['interviews','tasks','application_cvs','application_contacts','application_tags']) {
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
      await client.query('UPDATE jobs SET description_md=$2,description_source=$3,description_captured_on=$4 WHERE id=$1',[a.job_id,input.content,parsed.source || null, isoDate.safeParse(parsed.capturedOn).success ? parsed.capturedOn : null])
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
}
