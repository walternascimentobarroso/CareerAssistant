import { emptyPersonalProfile } from '../dashboard/src/domain/personalProfile'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPool } from './db/connection'
import { migrate } from './db/migrate'
import { PostgresStore } from './postgres-store'
import { api } from './api'
import { parseJobDescription, serializeJobDescription } from '../dashboard/src/domain/jobDescription'
import { preparationSummary, type PreparationAnswer } from '../dashboard/src/domain/applicationPreparation'

const url=process.env.TEST_DATABASE_URL
const schema=`career_test_${randomUUID().replaceAll('-','')}`
let admin:pg.Pool, pool:pg.Pool, store:PostgresStore, root:string
before(async () => {
  if (!url) return
  root=mkdtempSync(join(tmpdir(),'career-pg-'))
  admin=createPool(root,url)
  await admin.query(`CREATE SCHEMA ${schema}`)
  pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c timezone=UTC`})
  store=new PostgresStore(root,pool)
  await migrate(pool)
})
after(async () => {
  if (!url) return
  await pool?.end()
  await admin?.query(`DROP SCHEMA ${schema} CASCADE`)
  await admin?.end()
  if (root) rmSync(root,{recursive:true,force:true})
})
const integration={skip:!url}
async function create(company='Acme') {
  return store.createApplication({fields:{company,role:'Backend',next_action:{type:'apply',description:'Send application'},rate:{requested:'75000.1250',minimum:'65000',currency:'EUR',period:'year'}},applied:false,date:'2026-10-03',jobPosting:'Original posting'})
}
async function request(method:string,path:string,body?:unknown) {
  const req=Readable.from(body===undefined ? []:[JSON.stringify(body)]) as IncomingMessage
  req.method=method;req.url=path;req.headers={host:'localhost:5173','content-type':'application/json'}
  let status=0,value=''
  const res={writeHead(code:number){status=code},end(text:string){value=text}} as unknown as ServerResponse
  await api(store)(req,res)
  return {status,value:JSON.parse(value)}
}
test('migrations are transactional and repeatable',integration,async () => {
  assert.deepEqual(await migrate(pool),[])
  assert.equal((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'8')
})
test('exact decimals, duplicate opportunity slugs, status history and stale concurrency',integration,async () => {
  let a=await create()
  const b=await create()
  assert.notEqual(a.id,b.id);assert.notEqual(a.slug,b.slug)
  assert.equal(a.data.rate?.requested,'75000.1250')
  const prior=a.revision
  const results=await Promise.allSettled([
    store.status(a.slug,{revision:prior,status:'applied',date:'2026-10-03'}),
    store.status(a.slug,{revision:prior,status:'offer',date:'2026-10-03'}),
  ])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  a=await store.application(a.slug)
  assert.equal(a.data.timeline.filter(e=>e.type==='status_changed').length,1)
  assert.equal(a.data.applied_at,'2026-10-03')
  const again=await store.status(a.slug,{revision:a.revision,status:a.data.status,date:'2026-10-03'})
  assert.equal(again.revision,a.revision)
  await assert.rejects(store.updateApplication(a.slug,{revision:prior,fields:{role:'Lost edit'}}))
  assert.equal((await request('PATCH',`/api/applications/${a.id}/status`,{revision:a.revision,status:'applied',date:'2026-02-30'})).status,422)
})
test('CV ancestry and sent snapshots survive edits, customization and reselection',integration,async () => {
  const master=await store.saveCv('master','# Original master',null)
  const backend=await store.saveCv('backend','# Backend',null,{derivedFromVersionId:master.versionId})
  let a=await create('CV Co')
  a=await store.attachCv(a.slug,{name:'backend',revision:a.revision,sourceRevision:backend.revision,cvRevision:null})
  a=await store.customizeCv(a.slug,{revision:a.revision,sourceVersionId:backend.versionId,content:'# Tailored for CV Co'})
  const tailored=a.cvHistory!.find(c=>c.state==='selected')!
  a=await store.sendCv(a.slug,{revision:a.revision,versionId:tailored.versionId,date:'2026-10-03'})
  const updated=await store.saveCv('backend','# Backend changed',backend.revision)
  a=await store.attachCv(a.slug,{name:'backend',revision:a.revision,sourceRevision:updated.revision,cvRevision:tailored.id})
  const sent=a.cvHistory!.filter(c=>c.state==='sent')
  assert.equal(sent.length,1);assert.equal(sent[0].content,'# Tailored for CV Co')
  assert.equal(a.documents['cv.md'],'# Backend changed')
  await assert.rejects(pool.query('UPDATE cv_versions SET content_md=$2 WHERE id=$1',[tailored.versionId,'# overwrite']),{code:'23514'})
  await assert.rejects(pool.query('UPDATE application_cvs SET cv_version_id=$2 WHERE id=$1',[sent[0].id,updated.versionId]),{code:'23514'})
  await assert.rejects(pool.query('UPDATE cv_versions SET deleted_at=now() WHERE id=$1',[backend.versionId]),{code:'23514'})
  const foreign=await store.saveCv('foreign','# Other',null)
  await assert.rejects(pool.query('UPDATE cvs SET current_version_id=$2 WHERE id=$1',[master.id,foreign.versionId]),{code:'23503'})
  assert.equal((await store.cvVersions('backend')).length,2)
})
test('permanent deletion only purges trash, rejects stale revisions and preserves shared data',integration,async () => {
  let a=await create('Permanent Trash Co')
  const other=await create('Permanent Trash Co')
  a=await store.createInterview(a.slug,{revision:a.revision,kind:'technical',status:'completed',date:'2026-10-03',participants:[{name:'Recruiter'}]})
  const interview=(await pool.query('SELECT id FROM interviews WHERE application_id=$1',[a.id])).rows[0]
  await pool.query("INSERT INTO interview_analyses(interview_id,input_sha256,summary_md) VALUES ($1,$2,'Analysis')",[interview.id,'a'.repeat(64)])
  await pool.query("INSERT INTO attachments(interview_id,kind,storage_uri,original_filename) VALUES ($1,'transcript','local:test','transcript.txt')",[interview.id])
  assert.equal((await request('DELETE',`/api/trash/${a.id}`,{revision:a.revision})).status,404)
  await assert.rejects(pool.query('DELETE FROM application_events WHERE application_id=$1',[a.id]),{code:'23514'})
  await store.deleteApplication(a.id!,{revision:a.revision})
  const removed=(await store.trash()).find(row=>row.id===a.id)
  assert.equal((await request('DELETE',`/api/trash/${a.id}`,{revision:a.revision})).status,409)
  assert.equal((await request('DELETE',`/api/trash/${a.id}`,{revision:String(removed.revision)})).status,200)
  for (const table of ['applications','application_events','interviews','tasks','application_cvs','application_contacts','application_tags']) {
    const column=table==='applications' ? 'id' : 'application_id'
    assert.equal((await pool.query(`SELECT count(*) FROM ${table} WHERE ${column}=$1`,[a.id])).rows[0].count,'0')
  }
  for (const table of ['interview_participants','interview_analyses','attachments']) {
    assert.equal((await pool.query(`SELECT count(*) FROM ${table} WHERE interview_id=$1`,[interview.id])).rows[0].count,'0')
  }
  assert.equal((await store.trash()).some(row=>row.id===a.id),false)
  await assert.rejects(store.restoreApplication(a.id!,{revision:String(removed.revision)}),{status:404})
  assert.equal((await store.application(other.id!)).id,other.id)
})
test('soft delete hides all child views; restore does not revive individually deleted children',integration,async () => {
  let a=await create('Trash Co')
  a=await store.createInterview(a.slug,{revision:a.revision,kind:'technical',status:'completed',date:'2026-10-03',transcript:'Exact transcript',participants:[{name:'Recruiter'}]})
  const task=a.tasks![0]
  await pool.query('UPDATE tasks SET deleted_at=now() WHERE id=$1',[task.id])
  await store.deleteApplication(a.slug,{revision:a.revision})
  await assert.rejects(store.application(a.id!))
  assert.equal((await store.applications()).applications.some(row=>row.id===a.id),false)
  const removed=(await store.trash()).find(row=>row.id===a.id)
  a=await store.restoreApplication(a.id!,{revision:String(removed.revision)})
  assert.equal(a.tasks!.length,0)
  assert.equal(a.interviews.length,1)
  assert.equal(a.documents['interviews/01-technical/transcript.md'],'Exact transcript')
  await store.deleteApplication(a.slug,{revision:a.revision})
  await assert.rejects(pool.query("INSERT INTO tasks(application_id,type,description,status) VALUES ($1,'apply','Hidden','pending')",[a.id]),{code:'23514'})
})
test('shared parent protection, task completion, event ownership, date checks and immutable timeline',integration,async () => {
  let a=await create('Protected Co')
  const b=await create('Other Co')
  const company=(await pool.query('SELECT company_id FROM jobs WHERE id=$1',[a.jobId])).rows[0].company_id
  await assert.rejects(pool.query('UPDATE companies SET deleted_at=now() WHERE id=$1',[company]),{code:'23514'})
  await assert.rejects(pool.query('UPDATE jobs SET deleted_at=now() WHERE id=$1',[a.jobId]),{code:'23514'})
  const task=a.tasks![0]
  a=await store.completeTask(a.slug,{revision:a.revision,taskId:task.id})
  assert.equal(a.data.next_action,undefined);assert.equal(a.tasks![0].status,'completed')
  await assert.rejects(pool.query("INSERT INTO application_events(application_id,sequence_number,type,description,occurred_on,task_id) VALUES ($1,99,'task','wrong','2026-10-03',$2)",[b.id,task.id]),{code:'23503'})
  await assert.rejects(pool.query("INSERT INTO application_events(application_id,sequence_number,type,description) VALUES ($1,99,'missing','date')",[a.id]),{code:'23514'})
  await assert.rejects(pool.query('UPDATE application_events SET description=$2 WHERE id=$1',[a.eventIds![0],'rewritten']),{code:'23514'})
  await assert.rejects(pool.query('UPDATE applications SET requested_amount=$2 WHERE id=$1',[a.id,'NaN']),{code:'23514'})
})
test('messages retain identity and restore; API rejects stale writes and cross-origin requests',integration,async () => {
  const message=await store.createMessage({title:'Follow up',content:'Hello\n\nThanks.'})
  await store.deleteMessage(message.slug,{revision:String(message.revision)})
  assert.equal((await store.messages()).messages.some(m=>m.id===message.id),false)
  const row=(await pool.query('SELECT row_version FROM message_templates WHERE id=$1',[message.id])).rows[0]
  const restored=await store.restoreMessage(message.slug,{revision:String(row.row_version)})
  assert.equal(restored.id,message.id);assert.equal(restored.content,message.content)
  assert.equal((await request('PUT',`/api/messages/${message.slug}`,{title:'Lost',content:'Lost',revision:String(message.revision)})).status,409)
})
test('HTTP API serves PostgreSQL data and supports CV selection and submission with UUID association tokens',integration,async () => {
  const server=createServer(api(store))
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address() as {port:number}
  const base=`http://127.0.0.1:${address.port}`
  const call=async (path:string,method='GET',body?:unknown) => {
    const response=await fetch(base+'/api'+path,{method,headers:body ? {'Content-Type':'application/json'}:{},body:body ? JSON.stringify(body):undefined})
    return {status:response.status,body:await response.json()}
  }
  try {
    assert.equal((await call('/config')).body.timezone,'Europe/Lisbon')
    const created=await call('/applications','POST',{fields:{company:'HTTP Co',role:'Backend',rate:{requested:'123.4567',currency:'EUR',period:'hour'}},applied:false,date:'2026-10-03'})
    assert.equal(created.status,201)
    let a=created.body
    const cv=(await call('/cvs','POST',{name:'http-base',content:'# HTTP CV'})).body
    a=(await call(`/applications/${a.id}/cv`,'POST',{name:cv.name,revision:a.revision,sourceRevision:cv.revision,cvRevision:null})).body
    assert.equal(a.cvHistory[0].state,'selected')
    const first=a.cvHistory[0]
    const again=await call(`/applications/${a.id}/cv`,'POST',{name:cv.name,revision:a.revision,sourceRevision:cv.revision,cvRevision:first.id})
    assert.equal(again.status,200);a=again.body
    const sent=await call(`/applications/${a.id}/cv-send`,'POST',{revision:a.revision,versionId:cv.versionId,date:'2026-10-03'})
    assert.equal(sent.status,200)
    assert.equal(sent.body.cvHistory.filter((row:{state:string})=>row.state==='sent').length,1)
    const bad=await call('/applications','POST',{fields:{company:'Bad Decimal',role:'Backend',rate:{requested:123.4,currency:'EUR',period:'hour'}},applied:false,date:'2026-10-03'})
    assert.equal(bad.status,422)
    const cross=await fetch(base+'/api/applications',{headers:{Origin:'https://example.com'}})
    assert.equal(cross.status,403)
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error ? reject(error):resolve())) }
})

test('restore enforces CV dependencies and company deletion respects contacts',integration,async () => {
  const cv=await store.saveCv('restore-base','# Restore base',null)
  let a=await create('Restore Dependency Co')
  a=await store.attachCv(a.slug,{name:cv.name,revision:a.revision,sourceRevision:cv.revision,cvRevision:null})
  await store.deleteApplication(a.slug,{revision:a.revision})
  await pool.query('UPDATE cvs SET deleted_at=now() WHERE id=$1',[cv.id])
  const removed=(await store.trash()).find(item=>item.id===a.id)
  await assert.rejects(store.restoreApplication(a.id!,{revision:String(removed.revision)}),{code:'23514'})
  await pool.query('UPDATE cvs SET deleted_at=NULL WHERE id=$1',[cv.id])
  assert.equal((await store.restoreApplication(a.id!,{revision:String(removed.revision)})).id,a.id)
  const company=(await pool.query("INSERT INTO companies(name) VALUES ('Agency with contact') RETURNING id")).rows[0]
  await pool.query("INSERT INTO contacts(name,company_id) VALUES ('Recruiter',$1)",[company.id])
  await assert.rejects(pool.query('UPDATE companies SET deleted_at=now() WHERE id=$1',[company.id]),{code:'23514'})
})
test('job posting capture is stored with the application, kept apart from its date and preserved by copies and edits',integration,async () => {
  const capture={inputKind:'url',sourceUrl:'https://example.com/jobs/1',resolvedUrl:'https://careers.example.com/jobs/1',capturedAt:'2026-10-04T23:30:00.000Z',method:'json_ld',edited:false} as const
  const job=async (id:string) => (await pool.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0]
  let a=await store.createApplication({fields:{company:'Capture Co',role:'Backend',job_url:'https://example.com/other'},applied:true,date:'2024-01-15',jobPosting:'## Technologies\n\nImported text',jobPostingCapture:capture})
  let row=await job(a.jobId!)
  assert.equal(row.description_input_kind,'url');assert.equal(row.description_source,capture.sourceUrl);assert.equal(row.description_resolved_url,capture.resolvedUrl)
  assert.equal(row.description_captured_at.toISOString(),capture.capturedAt);assert.equal(row.description_capture_method,'json_ld');assert.equal(row.description_edited_after_capture,false)
  // Europe/Lisbon is already on the next day at this instant; the 2024 application date plays no part.
  assert.equal((await pool.query('SELECT description_captured_on::text AS day FROM jobs WHERE id=$1',[a.jobId])).rows[0].day,'2026-10-05')
  assert.equal(a.data.applied_at,'2024-01-15');assert.equal(a.data.job_url,'https://example.com/other')
  assert.deepEqual(a.jobPostingProvenance,{inputKind:'url',capturedAt:capture.capturedAt,resolvedUrl:capture.resolvedUrl,method:'json_ld',edited:false})
  const saved=parseJobDescription(a.documents['job-description.md'])
  assert.equal(saved.originalText,'## Technologies\n\nImported text');assert.deepEqual(saved.technologies,[]);assert.deepEqual(saved.provenance,a.jobPostingProvenance)

  const stale=a.jobRevision!
  a=(await request('PUT',`/api/applications/${a.id}/job-description`,{revision:stale,content:serializeJobDescription({...saved,source:'https://example.com/moved',provenance:undefined})})).value
  assert.equal(a.jobPostingProvenance!.edited,false);assert.equal(a.jobPostingProvenance!.resolvedUrl,capture.resolvedUrl)
  assert.equal((await request('PUT',`/api/applications/${a.id}/job-description`,{revision:stale,content:'# Job Description\n\n## Original text\n\nLost'})).status,409)
  a=await store.saveJobDescription(a.slug,{revision:a.jobRevision!,content:serializeJobDescription({...saved,originalText:'Rewritten'})})
  row=await job(a.jobId!)
  assert.equal(row.description_edited_after_capture,true);assert.equal(row.description_captured_at.toISOString(),capture.capturedAt)
  assert.equal(parseJobDescription(a.documents['job-description.md']).provenance!.edited,true)

  const before=a.jobId
  a=await store.updateApplication(a.slug,{revision:a.revision,fields:{company:'Capture Holding'}})
  assert.notEqual(a.jobId,before);assert.equal(a.jobPostingProvenance!.resolvedUrl,capture.resolvedUrl);assert.equal(a.jobPostingProvenance!.edited,true)
  const sibling=await pool.query('INSERT INTO applications(job_id,slug,status) VALUES ($1,$2,$3) RETURNING id',[a.jobId,'capture-sibling','interested'])
  a=await store.updateApplication(a.slug,{revision:a.revision,fields:{role:'Platform'}})
  assert.notEqual(a.jobId,sibling.rows[0].job_id);assert.equal((await job(a.jobId!)).description_capture_method,'json_ld')

  const before2=Date.now()
  const manual=await store.createApplication({fields:{company:'Manual Co',role:'Backend',job_url:'https://example.com/manual'},applied:true,date:'2024-01-15',jobPosting:'Pasted text'})
  row=await job(manual.jobId!)
  assert.equal(row.description_input_kind,'manual');assert.equal(row.description_source,'https://example.com/manual');assert.equal(row.description_resolved_url,null)
  assert.ok(row.description_captured_at.getTime()>=before2)
  const none=await store.createApplication({fields:{company:'No Posting Co',role:'Backend'},applied:false,date:'2026-10-03'})
  row=await job(none.jobId!)
  assert.equal(row.description_input_kind,null);assert.equal(row.description_captured_at,null);assert.equal(none.jobPostingProvenance,null)
  const legacy='# Job Description\n\nSource: https://example.com/legacy\nCaptured on: 2025-03-01\n\n## Original text\n\nLegacy text\n'
  const edited=await store.saveJobDescription(none.slug,{revision:null,content:legacy})
  assert.equal(edited.documents['job-description.md'],legacy);assert.equal((await job(none.jobId!)).description_input_kind,null)

  const invalid=[{...capture,inputKind:'manual'},{inputKind:'url',sourceUrl:capture.sourceUrl},{...capture,resolvedUrl:'file:///etc/passwd'},{...capture,method:'guess'}]
  for (const jobPostingCapture of invalid) assert.equal((await request('POST','/api/applications',{fields:{company:'Bad Capture',role:'Backend'},applied:false,date:'2026-10-03',jobPosting:'Text',jobPostingCapture})).status,422)
  assert.equal((await request('POST','/api/applications',{fields:{company:'Bad Capture',role:'Backend'},applied:false,date:'2026-10-03',jobPostingCapture:{inputKind:'manual'}})).status,422)
  await assert.rejects(pool.query("UPDATE jobs SET description_capture_method='html' WHERE id=$1",[none.jobId]),{code:'23514'})
})

test('personal profile concurrency, decimals, soft delete, uniqueness, atomicity and API validation', integration, async () => {
  assert.deepEqual(await store.personalProfile(), { profile: null })
  const input = { ...emptyPersonalProfile, salaryExpected: '900719925474099.1234', salaryMinimum: '900719925474099.1233', salaryCurrency: 'EUR', salaryPeriod: 'year' as const,
    workAuthorizations: [{ country: 'PT', authorization: 'authorized' as const, sponsorship: 'unknown' as const, notes: null }, { country: 'US', authorization: 'not_authorized' as const, sponsorship: 'yes' as const, notes: 'Needs sponsor' }],
    languages: [{ code: 'pt', level: 'native' as const }], contractPreferences: ['b2b' as const], revision: null }
  const creates = await Promise.allSettled([store.savePersonalProfile(input), store.savePersonalProfile(input)])
  assert.equal(creates.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((creates.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.status, 409)
  let profile = (await store.personalProfile()).profile!
  assert.equal(profile.salaryExpected, input.salaryExpected)
  assert.equal(profile.salaryMinimum, input.salaryMinimum)
  assert.equal(profile.workAuthorizations.find(v => v.country === 'PT')?.sponsorship, 'unknown')
  const { id, ...update } = profile
  const writes = await Promise.allSettled([store.savePersonalProfile({ ...update, name: 'First' }), store.savePersonalProfile({ ...update, name: 'Second' })])
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((writes.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.status, 409)
  profile = (await store.personalProfile()).profile!
  const { id: _id, ...current } = profile
  const removed = (await store.savePersonalProfile({ ...current, languages: [], workAuthorizations: [profile.workAuthorizations[0]] })).profile!
  assert.notEqual(removed.revision, profile.revision)
  assert.equal(removed.languages.length, 0)
  assert.equal((await pool.query('SELECT count(*) FROM personal_profile_languages WHERE profile_id=$1 AND deleted_at IS NOT NULL', [id])).rows[0].count, '1')
  assert.equal((await pool.query('SELECT count(*) FROM personal_profile_work_authorizations WHERE profile_id=$1 AND deleted_at IS NOT NULL', [id])).rows[0].count, '1')
  await assert.rejects(pool.query('INSERT INTO personal_profiles DEFAULT VALUES'), { code: '23505' })
  await assert.rejects(pool.query("INSERT INTO personal_profile_contract_preferences(profile_id,contract_type) VALUES ($1,'b2b')", [id]), { code: '23505' })
  // Inject a database failure after the parent update to verify rollback of the whole save.
  await pool.query("CREATE FUNCTION reject_test_language() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='en' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$")
  await pool.query('CREATE TRIGGER reject_test_language BEFORE INSERT ON personal_profile_languages FOR EACH ROW EXECUTE FUNCTION reject_test_language()')
  try {
    const { id: _removedId, ...last } = removed
    await assert.rejects(store.savePersonalProfile({ ...last, name: 'Must roll back', languages: [{ code: 'en', level: 'C1' }] }))
    assert.deepEqual((await store.personalProfile()).profile, removed)
  } finally { await pool.query('DROP TRIGGER reject_test_language ON personal_profile_languages'); await pool.query('DROP FUNCTION reject_test_language()') }
  assert.equal((await request('PUT','/api/profile',{ ...input, revision: removed.revision, website: 'javascript:alert(1)' })).status, 400)
  const invalid = await request('PUT','/api/profile',{ ...input, revision: removed.revision, extra: 'unexpected' })
  assert.equal(invalid.status, 400)
  assert.equal((await request('PUT','/api/profile',input)).status, 409)
  assert.equal((await request('GET','/api/profile')).value.profile.id, id)
  // Active-child guards reject restoration beneath a removed profile.
  await pool.query('UPDATE personal_profiles SET deleted_at=now() WHERE id=$1', [id])
  await assert.rejects(pool.query("INSERT INTO personal_profile_languages(profile_id,code,level) VALUES ($1,'en','C1')", [id]), { code: '23514' })
  assert.deepEqual(await store.personalProfile(), { profile: null })
})

test('knowledge base and application preparation keep snapshots, scoped memory, revisions and lifecycle', integration, async () => {
  const knowledge = { concept: 'relocation.willing', question: 'Are you willing to relocate?', language: 'en', category: 'relocation' as const, answer: { type: 'boolean' as const, value: true }, context: [], aliases: ['Would you relocate?'], confirmed: true }
  let entry = await store.saveKnowledge(null, knowledge)
  assert.deepEqual([entry.aliases, entry.origin, entry.confirmed], [['Would you relocate?'], 'USER', true])
  await assert.rejects(store.saveKnowledge(null, knowledge), { status: 409 })
  const edits = await Promise.allSettled([store.saveKnowledge(entry.id, { ...knowledge, revision: entry.revision }), store.saveKnowledge(entry.id, { ...knowledge, question: 'Relocate?', revision: entry.revision })])
  assert.equal(edits.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((edits.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.status, 409)
  entry = await store.saveKnowledge(entry.id, { ...knowledge, revision: (await store.knowledge()).entries.find(e => e.id === entry.id)!.revision })
  let profile = (await store.savePersonalProfile({ ...emptyPersonalProfile, name: 'Ada', workAuthorizations: [{ country: 'DE', authorization: 'authorized', sponsorship: 'no', notes: null }], revision: null })).profile!

  const application = await create('Preparation Co')
  assert.deepEqual(await store.preparation(application.slug), { preparation: null })
  const starts = await Promise.all([store.startPreparation(application.slug), store.startPreparation(application.slug)])
  assert.equal(starts[0].preparation.id, starts[1].preparation.id)
  let p = starts[0].preparation
  const id = p.id
  const cv = await store.saveCv('preparation-cv', '# CV v1', null)
  p = (await store.selectPreparationCv(id, { revision: p.revision, cvVersionId: cv.versionId })).preparation
  await store.saveCv('preparation-cv', '# CV v2', cv.revision)
  await assert.rejects(pool.query('UPDATE cv_versions SET deleted_at=now() WHERE id=$1', [cv.versionId]), { code: '23514' })
  await assert.rejects(store.selectPreparationCv(id, { revision: p.revision, cvVersionId: randomUUID() }), { status: 404 })
  p = (await store.updatePreparation(id, { revision: p.revision, country: 'DE', language: 'en', cvRequired: true })).preparation
  for (const question of [{ question: 'would you relocate', concept: null }, { question: 'Need sponsorship?', concept: 'work_authorization.requires_sponsorship' }, { question: 'Why this company?', concept: null, type: 'text' as const }]) {
    p = (await store.addPreparationAnswer(id, { type: 'boolean', options: [], required: true, ...question, revision: p.revision })).preparation
  }
  await assert.rejects(store.resolvePreparation(id, { revision: '1' }), { status: 409 })
  p = (await store.resolvePreparation(id, { revision: p.revision })).preparation
  let [relocation, sponsorship, motivation] = p.answers
  assert.deepEqual([relocation.answer, relocation.source, relocation.approval, relocation.evidence?.sources[0].id], [{ type: 'boolean', value: true }, 'KNOWLEDGE_BASE', 'accepted', entry.id])
  assert.deepEqual([sponsorship.answer, sponsorship.source, sponsorship.evidence?.sources[0].revision], [{ type: 'boolean', value: false }, 'PROFILE', profile.revision])
  assert.deepEqual([motivation.answer, motivation.source, motivation.approval], [null, 'UNKNOWN', 'pending'])
  assert.deepEqual([p.cv?.version, preparationSummary(p).completeness, preparationSummary(p).status], [1, 75, 'NOT_READY'])

  // Editing the sources afterwards changes neither the snapshot nor a later resolution of reviewed answers.
  await store.saveKnowledge(entry.id, { ...knowledge, answer: { type: 'boolean', value: false }, revision: entry.revision })
  const { id: _profileId, ...current } = profile
  profile = (await store.savePersonalProfile({ ...current, workAuthorizations: [{ country: 'DE', authorization: 'authorized', sponsorship: 'yes', notes: null }] })).profile!
  p = (await store.resolvePreparation(id, { revision: p.revision })).preparation
  assert.deepEqual(p.answers.slice(0, 2).map(a => a.answer), [{ type: 'boolean', value: true }, { type: 'boolean', value: false }])

  const save = (answer: PreparationAnswer, changes: object) => store.savePreparationAnswer(id, answer.id, { question: answer.question, concept: answer.concept, type: answer.type, options: answer.options,
    required: answer.required, answer: answer.answer, approval: answer.approval, revision: p.revision, ...changes })
  motivation = p.answers[2]
  await assert.rejects(save(motivation, { approval: 'accepted' }), { status: 400 })
  await assert.rejects(save(motivation, { answer: { type: 'boolean', value: true } }), { status: 400 })
  const typed = { type: 'text' as const, value: 'I admire the product.' }
  const remember = { concept: 'motivation.company', category: 'motivation' as const, scopes: ['APPLICATION' as const] }
  await assert.rejects(save(motivation, { answer: typed, approval: 'pending', remember }), { status: 400 })
  await assert.rejects(save(motivation, { answer: typed, approval: 'accepted', remember: { ...remember, scopes: ['CONTRACT_TYPE' as const] } }), { status: 400 })
  const writes = await Promise.allSettled([save(motivation, { answer: typed, approval: 'accepted' }), save(motivation, { answer: { type: 'text', value: 'Other' }, approval: 'accepted' })])
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((writes.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.status, 409)
  p = (await store.preparation(application.slug)).preparation!
  // Approving for this application alone memorizes nothing.
  assert.equal((await store.knowledge()).entries.some(e => e.concept === 'motivation.company'), false)
  p = (await save(p.answers[2], { answer: typed, approval: 'accepted', remember })).preparation
  assert.deepEqual([p.answers[2].source, p.answers[2].approval, preparationSummary(p).completeness, preparationSummary(p).status], ['USER', 'accepted', 100, 'NEEDS_REVIEW'])
  const remembered = (await store.knowledge()).entries.find(e => e.concept === 'motivation.company')!
  assert.deepEqual(remembered.context, [{ type: 'APPLICATION', value: application.id }])
  // A duplicate memory fails the whole save, including the answer edit.
  await assert.rejects(save(p.answers[2], { answer: { type: 'text', value: 'Changed' }, approval: 'accepted', remember }), { status: 409 })
  assert.deepEqual((await store.preparation(application.slug)).preparation, p)

  const other = await create('Other Preparation Co')
  let q = (await store.startPreparation(other.slug)).preparation
  q = (await store.addPreparationAnswer(q.id, { question: 'Why this company?', concept: null, type: 'text', options: [], required: true, revision: q.revision })).preparation
  q = (await store.resolvePreparation(q.id, { revision: q.revision })).preparation
  assert.equal(q.answers[0].answer, null)

  // A new country sends reused answers back to review; the typed one remains the user's decision.
  p = (await store.updatePreparation(id, { revision: p.revision, country: 'US', language: 'en', cvRequired: true })).preparation
  assert.deepEqual(p.answers.map(a => a.approval), ['pending', 'pending', 'accepted'])
  p = (await store.resolvePreparation(id, { revision: p.revision })).preparation
  assert.deepEqual([p.answers[0].answer, p.answers[1].answer, p.answers[1].source], [{ type: 'boolean', value: false }, null, 'UNKNOWN'])

  const answers = `/api/preparations/${id}/answers`
  assert.equal((await request('GET', '/api/knowledge')).value.entries.length, 2)
  assert.equal((await request('GET', `/api/applications/${application.slug}/preparations`)).value.preparation.revision, p.revision)
  assert.equal((await request('POST', answers, { question: 'Notice?', concept: null, type: 'single_select', options: [], required: true, revision: p.revision })).status, 422)
  assert.equal((await request('POST', answers, { question: 'Notice?', concept: null, type: 'text', options: [], required: false, revision: '1' })).status, 409)
  const added = await request('POST', answers, { question: 'Notice?', concept: null, type: 'text', options: [], required: false, revision: p.revision })
  assert.equal(added.status, 201)
  const removed = await request('DELETE', `${answers}/${added.value.preparation.answers[3].id}`, { revision: added.value.preparation.revision })
  assert.deepEqual([removed.status, removed.value.preparation.answers.length], [200, 3])
  assert.equal((await request('POST', `/api/preparations/${id}/resolve`, { revision: p.revision })).status, 409)
  assert.equal((await request('PUT', `/api/knowledge/${remembered.id}`, { ...remembered, revision: remembered.revision })).status, 422)
  assert.equal((await request('DELETE', `/api/knowledge/${remembered.id}`, { revision: remembered.revision })).status, 200)
  assert.equal((await request('DELETE', `/api/knowledge/${remembered.id}`, { revision: remembered.revision })).status, 409)

  // Removal hides the preparation through its application; restore brings back the same snapshot; purge removes it.
  p = removed.value.preparation
  let removedApplication = await store.deleteApplication(application.slug, { revision: (await store.application(application.slug)).revision })
  assert.deepEqual(await store.preparation(application.slug), { preparation: null })
  await assert.rejects(store.resolvePreparation(id, { revision: p.revision }), { status: 404 })
  let trashed = (await store.trash()).find(row => row.id === removedApplication.id)
  await store.restoreApplication(application.slug, { revision: String(trashed.revision) })
  assert.deepEqual((await store.preparation(application.slug)).preparation, p)
  removedApplication = await store.deleteApplication(application.slug, { revision: (await store.application(application.slug)).revision })
  trashed = (await store.trash()).find(row => row.id === removedApplication.id)
  await store.permanentlyDeleteApplication(application.slug, { revision: String(trashed.revision) })
  assert.equal((await pool.query('SELECT count(*) FROM application_preparations WHERE id=$1', [id])).rows[0].count, '0')
  assert.equal((await pool.query('SELECT count(*) FROM application_answers WHERE preparation_id=$1', [id])).rows[0].count, '0')
})


test('singular preparation routes and partial patches preserve revisions and ownership', integration, async () => {
  const fields = { concept: 'availability.notice', question: 'Notice period?', language: 'en', category: 'availability', answer: { type: 'text', value: 'Two weeks' }, context: [], aliases: [], confirmed: true }
  const created = await request('POST', '/api/knowledge', fields)
  assert.equal(created.status, 201)
  const entry = created.value
  assert.deepEqual((await request('GET', `/api/knowledge/${entry.id}`)).value, entry)
  assert.equal((await request('GET', `/api/knowledge/${randomUUID()}`)).status, 404)
  const changed = await request('PATCH', `/api/knowledge/${entry.id}`, { revision: entry.revision, confirmed: false })
  assert.equal(changed.status, 200)
  assert.equal(changed.value.confirmed, false)
  assert.deepEqual(changed.value.answer, fields.answer)
  assert.equal((await request('PATCH', `/api/knowledge/${entry.id}`, { revision: entry.revision, question: 'Changed' })).status, 409)
  assert.equal((await request('PATCH', `/api/knowledge/${entry.id}`, { question: 'Changed' })).status, 422)

  const application = await create('Singular preparation')
  const path = `/api/applications/${application.id}/preparation`
  assert.deepEqual((await request('GET', path)).value, { preparation: null })
  const started = await request('POST', path)
  assert.equal(started.status, 200)
  assert.equal((await request('POST', path)).value.preparation.id, started.value.preparation.id)
  let p = (await store.addPreparationAnswer(started.value.preparation.id, { question: 'Notice period?', concept: 'availability.notice', type: 'text', options: [], required: true, revision: started.value.preparation.revision })).preparation
  const answerPath = `${path}/answers/${p.answers[0].id}`
  const saved = await request('PATCH', answerPath, { revision: p.revision, answer: fields.answer, approval: 'accepted' })
  assert.equal(saved.status, 200)
  assert.equal(saved.value.preparation.answers[0].source, 'USER')
  assert.equal(saved.value.preparation.answers[0].question, 'Notice period?')
  assert.equal((await request('PATCH', answerPath, { revision: p.revision, approval: 'pending' })).status, 409)
  p = saved.value.preparation
  assert.equal((await request('PATCH', answerPath, { revision: p.revision, type: 'single_select' })).status, 422)
  assert.equal((await request('PATCH', answerPath, { revision: p.revision, answer: null })).status, 400)
  const other = await create('Different preparation owner')
  await store.startPreparation(other.slug)
  assert.equal((await request('PATCH', `/api/applications/${other.id}/preparation/answers/${p.answers[0].id}`, { revision: '1', approval: 'pending' })).status, 404)
  assert.deepEqual((await request('GET', path)).value.preparation, p)
  await store.deleteApplication(application.slug, { revision: application.revision })
  assert.equal((await request('PATCH', answerPath, { revision: p.revision, approval: 'pending' })).status, 404)
})


test('ATS adaptation creates a derived editable CV atomically and rejects stale preparation state', integration, async () => {
  const application = await create('ATS adaptation company')
  const base = await store.saveCv('ats-base', '# Existing experience', null)
  const preparation = (await store.startPreparation(application.slug)).preparation
  const snapshot = await store.adaptationContext(application.slug, base.versionId)
  assert.equal(snapshot.cvContent, '# Existing experience')
  assert.equal(snapshot.company, 'ATS adaptation company')
  const adapted = await store.saveAdaptedPreparationCv(snapshot, '# Reformulated experience')
  const version = (await pool.query('SELECT * FROM cv_versions WHERE id=$1', [adapted.versionId])).rows[0]
  assert.equal(version.derived_from_version_id, base.versionId)
  assert.equal(version.change_note, 'ATS: Backend at ATS adaptation company')
  assert.equal((await store.preparation(application.slug)).preparation?.cv?.versionId, adapted.versionId)
  assert.equal((await store.cv('ats-base')).content, '# Existing experience')
  const count = (await pool.query('SELECT count(*) FROM cv_versions')).rows[0].count
  await assert.rejects(store.saveAdaptedPreparationCv(snapshot, '# Stale result'), { status: 409 })
  assert.equal((await pool.query('SELECT count(*) FROM cv_versions')).rows[0].count, count)
  const cv = (await pool.query('SELECT c.slug FROM cvs c JOIN cv_versions v ON v.cv_id=c.id WHERE v.id=$1', [adapted.versionId])).rows[0]
  const current = await store.cv(cv.slug)
  await store.saveCv(cv.slug, '# Reviewed CV', current.revision)
  assert.equal((await store.preparation(application.slug)).preparation?.cv?.versionId, adapted.versionId)
  assert.notEqual((await store.preparation(application.slug)).preparation?.revision, preparation.revision)
  await assert.rejects(store.adaptationContext(application.slug, randomUUID()), { status: 404 })
})


test('form inspection revisions and submission records are atomic, owned and idempotent', integration, async () => {
  let application = await create('Automated application')
  application = await store.updateApplication(application.slug, { revision: application.revision, fields: { apply_url: 'https://company.test/apply' } })
  const cv = await store.saveCv('automation-cv', '# CV', null)
  let p = (await store.startPreparation(application.slug)).preparation
  p = (await store.selectPreparationCv(p.id, { revision: p.revision, cvVersionId: cv.versionId })).preparation
  const context = await store.formContext(application.slug)
  assert.equal(context.snapshot.applyUrl, 'https://company.test/apply')
  assert.equal(context.cvContent, '# CV')
  const snapshot = await store.markFormInspected(context.snapshot, true)
  assert.equal((await store.preparation(application.slug)).preparation?.formInspected, true)
  let submitted = 0
  const sessionId = randomUUID()
  const other = await create('Different automated application')
  await assert.rejects(store.recordFormSubmission(other.slug, snapshot, sessionId, async () => { submitted++ }), { status: 409 })
  await assert.rejects(store.recordFormSubmission(application.slug, snapshot, sessionId, async () => { throw new Error('External failure') }), /External failure/)
  assert.equal((await store.application(application.slug)).data.status, 'interested')
  await store.recordFormSubmission(application.slug, snapshot, sessionId, async () => { submitted++ })
  await store.recordFormSubmission(application.slug, snapshot, sessionId, async () => { submitted++ })
  assert.equal(submitted, 1)
  const updated = await store.application(application.slug)
  assert.equal(updated.data.status, 'applied')
  assert.equal(updated.cvHistory?.filter(cv => cv.state === 'sent').length, 1)
  assert.equal(updated.data.timeline.filter(event => event.type === 'applied').length, 1)
  const sent = (await pool.query("SELECT channel FROM application_cvs WHERE application_id=$1 AND state='sent'", [application.id])).rows[0]
  assert.equal(sent.channel, 'https://company.test/apply')
})


test('manual submission atomically records status, date, CV and transition and rejects stale revisions', integration, async () => {
  const application = await create('Manual submission')
  const cv = await store.saveCv('manual-submission-cv', '# CV', null)
  await assert.rejects(store.recordSubmission(application.slug, { revision: application.revision, date: '2026-10-06', cvVersionId: randomUUID() }), { status: 404 })
  assert.equal((await store.application(application.slug)).data.status, 'interested')
  const submitted = await store.recordSubmission(application.slug, { revision: application.revision, date: '2026-10-06', channel: 'email', cvVersionId: cv.versionId })
  assert.equal(submitted.data.status, 'applied')
  assert.equal(submitted.data.applied_at, '2026-10-06')
  const sent = (await pool.query("SELECT * FROM application_cvs WHERE application_id=$1 AND state='sent'", [application.id])).rows[0]
  assert.equal(sent.cv_version_id, cv.versionId)
  assert.equal(sent.sent_on, '2026-10-06')
  assert.equal(sent.channel, 'email')
  const event = (await pool.query("SELECT * FROM application_events WHERE application_id=$1 AND type='applied'", [application.id])).rows[0]
  assert.deepEqual([event.occurred_on, event.from_status, event.to_status, event.application_cv_id], ['2026-10-06', 'interested', 'applied', sent.id])
  await assert.rejects(store.recordSubmission(application.slug, { revision: application.revision, date: '2026-10-06' }), { status: 409 })
  await assert.rejects(store.recordSubmission(application.slug, { revision: submitted.revision, date: '2026-10-06' }), { status: 409 })
  const withoutCv = await create('Manual without CV')
  await store.recordSubmission(withoutCv.slug, { revision: withoutCv.revision, date: '2026-10-06' })
  assert.equal((await pool.query('SELECT count(*) FROM application_cvs WHERE application_id=$1', [withoutCv.id])).rows[0].count, '0')
  assert.equal((await store.application(withoutCv.slug)).data.status, 'applied')
})
