import { useEffect, useState } from 'react'
import { request, useApplications, type Cv, type LiveApplication } from '../data/loadApplications'
import { STATUSES } from '../domain/constants'

export function AttachCv({ application }: { application: LiveApplication }) {
  const [cvs, setCvs] = useState<Cv[]>([])
  const [name, setName] = useState('')
  const [allow, setAllow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { reload } = useApplications()
  const historical = application.data.status !== STATUSES[0] && application.documents['cv.md'] !== undefined
  useEffect(() => { setAllow(false); setMessage(''); void request<Cv[]>('/cvs').then(setCvs).catch(e => setMessage(e.message)) }, [application.slug])
  async function attach() {
    const source = cvs.find(c => c.name === name)
    if (!source) return
    setBusy(true); setMessage('')
    try {
      const existing = application.documents['cv.md']
      const cvRevision = existing === undefined ? null : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(existing)))).map(b => b.toString(16).padStart(2, '0')).join('')
      await request(`/applications/${application.slug}/cv`, 'POST', { name, revision: application.revision, sourceRevision: source.revision, cvRevision, allowHistoricalEdit: allow })
      await reload(); setAllow(false); setMessage('CV copied to application.')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="attach-cv">
    <label>Copy a base CV<select value={name} disabled={busy} onChange={e => setName(e.target.value)}><option value="">Select CV</option>{cvs.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
    {historical && <label><input type="checkbox" checked={allow} onChange={e => setAllow(e.target.checked)} /> I explicitly authorize replacing the historical CV sent for this application.</label>}
    <button disabled={busy || !name || (historical && !allow)} onClick={() => void attach()}>{busy ? 'Saving…' : application.documents['cv.md'] === undefined ? 'Attach copy' : 'Replace copy'}</button>
    <p role="status">{message}</p>
  </div>
}
