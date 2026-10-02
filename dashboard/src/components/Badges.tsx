import { CONTRACT_TYPE_LABELS, PRIORITY_LABELS } from '../domain/constants'
import type { ApplicationData } from '../domain/schema'

export function Badges({ data }: { data: ApplicationData }) {
  return (
    <div className="badges">
      {data.priority && <span className={`badge priority-${data.priority}`}>{PRIORITY_LABELS[data.priority]}</span>}
      {data.type && <span className="badge">{CONTRACT_TYPE_LABELS[data.type]}</span>}
    </div>
  )
}
