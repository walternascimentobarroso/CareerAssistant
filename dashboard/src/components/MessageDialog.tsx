import { useEffect, useRef, useState } from 'react'
import { request, type LiveMessage } from '../data/loadApplications'
import { CopyButton } from './CopyButton'
import { confirmDiscard, useUnsavedGuard } from './useUnsavedGuard'

type Props = {
  /** `null` creates a new message. */
  message: LiveMessage | null
  startEditing: boolean
  onSaved: (message: LiveMessage) => void
  onDelete: (message: LiveMessage) => void
  onClose: () => void
}

export function MessageDialog({ message, startEditing, onSaved, onDelete, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState(startEditing)
  const [title, setTitle] = useState(message?.title ?? '')
  const [content, setContent] = useState(message?.content ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = editing && (title !== (message?.title ?? '') || content !== (message?.content ?? ''))
  useUnsavedGuard(dirty)
  useEffect(() => { dialog.current?.showModal() }, [])

  function stopEditing() {
    if (!confirmDiscard(dirty)) return
    if (!message) return onClose()
    setTitle(message.title); setContent(message.content); setError(''); setEditing(false)
  }
  async function save() {
    setBusy(true); setError('')
    try {
      const saved = message
        ? await request<LiveMessage>(`/messages/${message.slug}`, 'PUT', { title, content, revision: message.revision })
        : await request<LiveMessage>('/messages', 'POST', { title, content })
      setTitle(saved.title); setContent(saved.content); setEditing(false)
      onSaved(saved)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="message-dialog" onCancel={e => { if (!confirmDiscard(dirty)) e.preventDefault() }} onClose={onClose}>
    {editing || !message
      ? <form onSubmit={e => { e.preventDefault(); void save() }}>
        <h2>{message ? 'Edit message' : 'New message'}</h2>
        <label>Title<input value={title} maxLength={120} disabled={busy} autoFocus onChange={e => setTitle(e.target.value)} /></label>
        <label>Message (copied exactly as written)<textarea rows={14} value={content} disabled={busy} onChange={e => setContent(e.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="toolbar">
          <button disabled={busy || !title.trim() || !content.trim()}>{busy ? 'Saving…' : 'Save message'}</button>
          <button type="button" disabled={busy} onClick={stopEditing}>Cancel</button>
        </div>
      </form>
      : <>
        <h2>{message.title}</h2>
        <p className="message-text">{message.content}</p>
        <div className="toolbar">
          <CopyButton text={message.content} />
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="danger" onClick={() => onDelete(message)}>Delete</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </>}
  </dialog>
}
