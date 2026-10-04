import { useEffect, useState } from 'react'
import { request, useApplications, type Cv, type LiveApplication } from '../data/loadApplications'

export function AttachCv({ application }: { application: LiveApplication }) {
  const [cvs, setCvs] = useState<Cv[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { reload } = useApplications()
  useEffect(() => { setMessage(''); void request<Cv[]>('/cvs').then(setCvs).catch(e => setMessage(e.message)) }, [application.slug])
  async function attach() {
    const source = cvs.find(c => c.name === name)
    if (!source) return
    setBusy(true); setMessage('')
    try {
      const displayed = application.cvHistory?.find(c => c.state === 'selected') ?? application.cvHistory?.at(-1)
      await request(`/applications/${application.slug}/cv`, 'POST', { name, revision: application.revision, sourceRevision: source.revision, cvRevision: displayed?.id ?? null })
      await reload(); setMessage('CV version selected. Previous submissions are preserved.')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="attach-cv">
    <label>Select a CV version<select value={name} disabled={busy} onChange={e => setName(e.target.value)}><option value="">Select CV</option>{cvs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
    <button disabled={busy || !name} onClick={() => void attach()}>{busy ? 'Saving…' : 'Select version'}</button>
    <p role="status">{message}</p>
  </div>
}
