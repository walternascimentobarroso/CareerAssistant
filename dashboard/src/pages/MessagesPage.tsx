import { useCallback, useEffect, useState } from 'react'
import { MessageCard } from '../components/MessageCard'
import { MessageDialog } from '../components/MessageDialog'
import { request, type LiveMessage } from '../data/loadApplications'
import type { MessageError } from '../domain/messages'

type Opened = { message: LiveMessage | null; startEditing: boolean }

export function MessagesPage() {
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [errors, setErrors] = useState<MessageError[]>([])
  const [opened, setOpened] = useState<Opened | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const loaded = await request<{ messages: LiveMessage[]; errors: MessageError[] }>('/messages')
      setMessages(loaded.messages); setErrors(loaded.errors); setError('')
    } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(message: LiveMessage) {
    if (!window.confirm(`Delete "${message.title}"?\n\nThe file messages/${message.slug}.md is removed from disk. This cannot be undone from the dashboard.`)) return
    try {
      await request(`/messages/${message.slug}`, 'DELETE', { revision: message.revision })
      setOpened(null)
    } catch (e) { setError((e as Error).message) }
    await load()
  }

  return <article className="messages">
    <h1>Messages</h1>
    <p className="muted">Reusable messages kept in <code>messages/</code>. Copy one straight from its card, or open it to read it in full.</p>
    <div className="toolbar"><button onClick={() => setOpened({ message: null, startEditing: true })}>New message</button></div>
    {error && <p role="alert">{error}</p>}
    {errors.map(({ slug, issues }) => <p key={slug} role="alert"><code>messages/{slug}.md</code> could not be read: {issues.join('; ')}</p>)}
    {messages.length === 0 && !error && <p className="muted">No messages yet.</p>}
    <div className="message-grid">
      {messages.map(message => <MessageCard
        key={message.slug}
        message={message}
        onOpen={() => setOpened({ message, startEditing: false })}
        onEdit={() => setOpened({ message, startEditing: true })}
        onDelete={() => void remove(message)}
      />)}
    </div>
    {opened && <MessageDialog
      {...opened}
      onSaved={saved => { setOpened({ message: saved, startEditing: false }); void load() }}
      onDelete={message => void remove(message)}
      onClose={() => setOpened(null)}
    />}
  </article>
}
