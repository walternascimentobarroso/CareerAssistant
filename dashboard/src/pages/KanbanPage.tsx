import { useState } from 'react'
import { ApplicationCard } from '../components/ApplicationCard'
import { request, useApplications } from '../data/loadApplications'
import { CLOSED_STATUSES, STATUSES, STATUS_LABELS, type Status } from '../domain/constants'
import { todayIsoDate } from '../domain/format'

export function KanbanPage() {
  const { applications, reload } = useApplications()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dragged, setDragged] = useState<string | null>(null)
  async function move(slug: string, status: Status) {
    const a = applications.find(a => a.slug === slug)
    if (!a || a.data.status === status || pending) return
    const keepNextAction = !!a.data.next_action && CLOSED_STATUSES.includes(status)
      ? window.confirm('Keep the pending next action after closing this application? Cancel removes the action.') : false
    setPending(slug); setError('')
    try {
      await request(`/applications/${slug}/status`, 'PATCH', { status, revision: a.revision, date: todayIsoDate(), keepNextAction })
      await reload()
    } catch (e) { setError((e as Error).message) }
    finally { setPending(null) }
  }
  return <>
    <p aria-live="polite">{pending ? 'Saving status…' : 'Drag a card to a column or use its status selector.'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="board">
      {STATUSES.map(status => {
        const inColumn = applications.filter(a => a.data.status === status)
        return <section key={status} className={`column ${dragged ? 'drop-target' : ''}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }} onDrop={e => { e.preventDefault(); if (dragged) void move(dragged, status); setDragged(null) }}>
          <h2>{STATUS_LABELS[status]} <span className="count">{inColumn.length}</span></h2>
          {inColumn.map(a => <div key={a.slug} draggable={!pending} onDragStart={e => { setDragged(a.slug); e.dataTransfer.setData('text/plain', a.slug); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDragged(null)}>
            <ApplicationCard application={a} />
            <select aria-label={`Status for ${a.data.company}`} value={a.data.status} disabled={!!pending} onChange={e => void move(a.slug, e.target.value as Status)}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>)}
        </section>
      })}
    </div>
  </>
}
