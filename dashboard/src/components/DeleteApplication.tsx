import { useState } from 'react'
import { useNavigate } from 'react-router'
import { request, useApplications, type LiveApplication } from '../data/loadApplications'

export function DeleteApplication({ application }: { application: LiveApplication }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { reload } = useApplications()
  const navigate = useNavigate()
  async function remove() {
    const { company, role } = application.data
    if (!window.confirm(`Delete "${company} — ${role}"?\n\nThe folder applications/${application.slug}/ and everything in it is removed from disk. This cannot be undone from the dashboard.`)) return
    setBusy(true); setMessage('')
    try {
      await request(`/applications/${application.slug}`, 'DELETE', { revision: application.revision })
      await reload(); navigate('/')
    } catch (e) { setMessage((e as Error).message); setBusy(false) }
  }
  return <div className="attach-cv">
    <p className="muted">Registered by mistake or no longer interested? Deleting removes this application and its files for good. To keep a record instead, move it to Archived on the board.</p>
    <div className="toolbar"><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete application'}</button></div>
    <p role="status">{message}</p>
  </div>
}
