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
    if (!window.confirm(`Remove "${company} — ${role}"?\n\nYou can restore it from Trash.`)) return
    setBusy(true); setMessage('')
    try {
      await request(`/applications/${application.slug}`, 'DELETE', { revision: application.revision })
      await reload(); navigate('/')
    } catch (e) { setMessage((e as Error).message); setBusy(false) }
  }
  return <div className="attach-cv">
    <p className="muted">Removing hides this application. Its history is preserved and it can be restored from Trash.</p>
    <div className="toolbar"><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Remove application'}</button></div>
    <p role="status">{message}</p>
  </div>
}
