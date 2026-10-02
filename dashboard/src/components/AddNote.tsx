import { useState } from 'react'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'
import { useUnsavedGuard } from './useUnsavedGuard'

export function AddNote({ application }: { application: LiveApplication }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { reload } = useApplications()
  useUnsavedGuard(note.trim() !== '')
  async function add() {
    setBusy(true); setMessage('')
    try {
      await request(`/applications/${application.slug}/notes`, 'POST', { revision: application.revision, note })
      await reload(); setNote('')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <form className="note-form" onSubmit={e => { e.preventDefault(); void add() }}>
    <label>Add a note (Markdown, appended to the end)<textarea rows={4} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
    <div className="toolbar"><button disabled={busy || !note.trim()}>{busy ? 'Saving…' : 'Add note'}</button></div>
    <p role="status">{message}</p>
  </form>
}
