import { useState } from 'react'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { todayIsoDate } from '../domain/format'

export function AddTimelineEvent({ application }: { application: LiveApplication }) {
  const [date, setDate] = useState(todayIsoDate)
  const [type, setType] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { reload } = useApplications()
  async function add() {
    setBusy(true); setMessage('')
    try {
      const event = { date, type: type.trim().toLowerCase().replace(/\s+/g, '_'), description: description.trim() }
      await request(`/applications/${application.slug}`, 'PATCH', { revision: application.revision, fields: {}, event })
      await reload(); setType(''); setDescription('')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <form className="inline-form" onSubmit={e => { e.preventDefault(); void add() }}>
    <label>Date<input type="date" required value={date} disabled={busy} onChange={e => setDate(e.target.value)} /></label>
    <label>Type<input required value={type} disabled={busy} placeholder="interview, contact, offer…" onChange={e => setType(e.target.value)} /></label>
    <label className="grow">What happened<input required value={description} disabled={busy} onChange={e => setDescription(e.target.value)} /></label>
    <button disabled={busy}>{busy ? 'Saving…' : 'Add event'}</button>
    <p role="status">{message}</p>
  </form>
}
