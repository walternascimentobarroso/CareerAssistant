import { useState } from 'react'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { todayIsoDate } from '../domain/format'

export function ApplicationHistory({application}:{application:LiveApplication}) {
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [content,setContent]=useState('')
  const [sendDate,setSendDate]=useState(todayIsoDate)
  const {reload}=useApplications()
  const selected=application.cvHistory?.find(cv=>cv.state==='selected')
  async function mutate(action:string,fields:Record<string,unknown>) {
    setBusy(true); setMessage('')
    try { await request(`/applications/${application.slug}/${action}`,'POST',{revision:application.revision,...fields}); await reload(); setContent('') }
    catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    <section className="detail-section"><h2>CV history</h2>
      {!application.cvHistory?.length && <p>No CV recorded.</p>}
      {application.cvHistory?.map(cv=><details key={cv.id}><summary>{cv.name} v{cv.version} · {cv.state==='legacy_unknown' ? 'legacy copy — submission unknown' : cv.state}{cv.sentOn ? ` · ${cv.sentOn}` : ''}</summary><pre style={{whiteSpace:'pre-wrap'}}>{cv.content}</pre></details>)}
      {selected && <>
        <label>Sent on<input type="date" value={sendDate} onChange={e=>setSendDate(e.target.value)} /></label>
        <button disabled={busy || !sendDate} onClick={()=>void mutate('cv-send',{versionId:selected.versionId,date:sendDate})}>Record CV submission</button>
        <details><summary>Customize selected CV</summary>
          <button disabled={busy} onClick={()=>setContent(selected.content)}>Load selected content</button>
          <textarea rows={12} value={content} onChange={e=>setContent(e.target.value)} />
          <button disabled={busy || !content.trim()} onClick={()=>void mutate('cv-customize',{content,sourceVersionId:selected.versionId})}>Save tailored version</button>
        </details>
      </>}
    </section>
    <section className="detail-section"><h2>Task history</h2>
      {application.tasks?.map(task=><div className="toolbar" key={task.id}><span>{task.description} · {task.status}{task.date ? ` · ${task.date}` : ''}</span>
        {task.status==='pending' && <button disabled={busy} onClick={()=>void mutate('task-complete',{taskId:task.id})}>Complete</button>}
      </div>)}
    </section>
    <p role="status">{message}</p>
  </>
}
