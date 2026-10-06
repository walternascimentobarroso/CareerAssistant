import { useTranslation } from 'react-i18next'
import { CONTRACT_TYPE_LABELS, PRIORITY_LABELS } from '../domain/constants'
import type { ApplicationData } from '../domain/schema'

export function Badges({ data }: { data: ApplicationData }) {
  const { t } = useTranslation('status')
  return (
    <div className="badges">
      {data.priority && <span className={`badge priority-${data.priority}`}>{t(PRIORITY_LABELS[data.priority])}</span>}
      {data.type && <span className="badge">{t(CONTRACT_TYPE_LABELS[data.type])}</span>}
    </div>
  )
}
