import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import { MessageCard } from '../components/MessageCard'
import { MessageDialog } from '../components/MessageDialog'
import { request, type LiveMessage } from '../data/loadApplications'

type Opened = { message: LiveMessage | null; startEditing: boolean }

export function MessagesPage() {
  const { t } = useTranslation('pages')
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [opened, setOpened] = useState<Opened | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const loaded = await request<{ messages: LiveMessage[] }>('/messages')
      setMessages(loaded.messages); setError('')
    } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function remove(message: LiveMessage) {
    if (!window.confirm(t('messages.confirm_delete', { title: message.title }))) return
    try {
      await request(`/messages/${message.slug}`, 'DELETE', { revision: message.revision })
      setOpened(null)
    } catch (e) { setError((e as Error).message) }
    await load()
  }

  return <article className="messages">
    <h1>{t('messages.messages')}</h1>
    <p className="muted">{t('messages.reusable_messages_copy_one_straight_from_its_card_or_open_it_to_read_it_in_full')}</p>
    <div className="toolbar"><button onClick={() => setOpened({ message: null, startEditing: true })}>{t('messages.new_message')}</button></div>
    {error && <p role="alert">{error}</p>}
    {messages.length === 0 && !error && <p className="muted">{t('messages.no_messages_yet')}</p>}
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
