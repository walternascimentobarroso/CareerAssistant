import type { LiveMessage } from '../data/loadApplications'
import { CopyButton } from './CopyButton'

type Props = { message: LiveMessage; onOpen: () => void; onEdit: () => void; onDelete: () => void }

export function MessageCard({ message, onOpen, onEdit, onDelete }: Props) {
  return <article className="card message-card">
    <button type="button" className="message-open" onClick={onOpen}>
      <span className="card-company">{message.title}</span>
      <span className="message-preview">{message.content}</span>
    </button>
    <div className="toolbar">
      <CopyButton text={message.content} />
      <button type="button" onClick={onEdit}>Edit</button>
      <button type="button" className="danger" onClick={onDelete}>Delete</button>
    </div>
  </article>
}
