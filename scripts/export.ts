import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createPool, transaction } from '../server/db/connection'
import { PostgresStore } from '../server/postgres-store'

const root=resolve(import.meta.dirname,'..')
const argument=process.argv.indexOf('--output')
if (argument<0 || !process.argv[argument+1]) throw new Error('Usage: npm run db:export -- --output ./exports/new-directory')
const output=resolve(process.argv[argument+1])
const pool=createPool(root)
try {
  // Read one consistent snapshot; an existing destination is never overwritten.
  const snapshot=await transaction(pool,async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const store=new PostgresStore(root,pool)
    const rows=(await client.query('SELECT a.id FROM applications a JOIN jobs j ON j.id=a.job_id JOIN companies c ON c.id=j.company_id WHERE a.deleted_at IS NULL AND j.deleted_at IS NULL AND c.deleted_at IS NULL')).rows
    const applications=[]
    for (const row of rows) applications.push(await store.application(row.id,client))
    const cvs=(await client.query('SELECT c.slug,v.version_number,v.content_md FROM cvs c JOIN cv_versions v ON v.cv_id=c.id WHERE c.deleted_at IS NULL AND v.deleted_at IS NULL ORDER BY c.slug,v.version_number')).rows
    const messages=(await client.query('SELECT slug,title,content FROM message_templates WHERE deleted_at IS NULL')).rows
    return {applications,cvs,messages}
  })
  mkdirSync(output) // parent must exist; exclusive creation prevents overwriting an older export.
  const write=(relative:string,content:string) => {
    const path=resolve(output,relative)
    if (!path.startsWith(output+sep)) throw new Error('Invalid document path in export')
    mkdirSync(resolve(path,'..'),{recursive:true})
    writeFileSync(path,content,{flag:'wx'})
  }
  for (const application of snapshot.applications) {
    for (const [path,content] of Object.entries(application.documents)) write(`applications/${application.slug}/${path}`,content)
    for (const cv of application.cvHistory ?? []) write(`applications/${application.slug}/cv-history/${cv.id}-${cv.state}.md`,cv.content)
  }
  for (const cv of snapshot.cvs) write(`cv/${cv.slug}/v${cv.version_number}.md`,cv.content_md)
  for (const message of snapshot.messages) write(`messages/${message.slug}.md`,`# ${message.title}\n\n${message.content}`)
  write('README.md','# Career Assistant Markdown export\n\nRead-only snapshot of active application documents, available CV versions and reusable messages. It is not a full database backup or an input for automatic synchronization. Use pg_dump for complete data, removed records, relations and import provenance.\n')
  console.log(`Exported ${snapshot.applications.length} applications, ${snapshot.cvs.length} CV versions and ${snapshot.messages.length} messages.`)
} finally { await pool.end() }
