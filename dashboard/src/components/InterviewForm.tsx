import { useState } from 'react'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'

export function InterviewForm({application}:{application:LiveApplication}) {
  const [kind,setKind]=useState('recruiter')
  const [date,setDate]=useState('')
  const [status,setStatus]=useState('scheduled')
  const [participants,setParticipants]=useState('')
  const [notes,setNotes]=useState('')
  const [transcript,setTranscript]=useState('')
  const [summary,setSummary]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const {reload}=useApplications()
  async function save() {
    setBusy(true); setMessage('')
    try {
      await request(`/applications/${application.slug}/interviews`,'POST',{revision:application.revision,kind,status,...(date && {date}),
        participants:participants.split('\n').map(name=>name.trim()).filter(Boolean).map(name=>({name})),...(notes && {notes}),...(transcript && {transcript}),...(summary && {summary})})
      await reload(); setNotes(''); setTranscript(''); setSummary(''); setParticipants(''); setMessage('Interview saved.')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <details><summary>Add interview</summary><form className="application-form" onSubmit={e=>{e.preventDefault();void save()}}>
    <label>Type<input required value={kind} onChange={e=>setKind(e.target.value)} /></label>
    <label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
    <label>Status<select value={status} onChange={e=>setStatus(e.target.value)}>{['scheduled','completed','cancelled','unknown'].map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Participants (one per line)<textarea value={participants} onChange={e=>setParticipants(e.target.value)} /></label>
    <label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} /></label>
    <label>Full transcript<textarea rows={8} value={transcript} onChange={e=>setTranscript(e.target.value)} /></label>
    <label>Summary<textarea rows={6} value={summary} onChange={e=>setSummary(e.target.value)} /></label>
    <button disabled={busy}>{busy ? 'Saving…':'Save interview'}</button><p role="status">{message}</p>
  </form></details>
}
