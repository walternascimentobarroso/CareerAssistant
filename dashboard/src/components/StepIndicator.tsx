import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { FlowStep } from '../domain/applicationFlow'

export function StepIndicator({ steps }: { steps: readonly FlowStep[] }) {
  const { t } = useTranslation('pages')
  return <nav className="steps-nav" aria-label={t('flow.nav_label')}>
    <ol className="steps">
      {steps.map((step, index) => {
        const content = <>
          <span className="step-circle">{step.status === 'completed' ? <span aria-hidden="true">✓</span> : index + 1}</span>
          <span className="step-label">{step.label}</span>
          {step.status !== 'active' && <span className="visually-hidden"> {t(`flow.status.${step.status}`)}</span>}
        </>
        return <li key={step.id} className="step" data-status={step.status} aria-current={step.status === 'active' ? 'step' : undefined}>
          {/* A plain link, so the unsaved-changes guard still intercepts the navigation. */}
          {step.to && step.status !== 'active' ? <Link to={step.to} className="step-link">{content}</Link> : <span className="step-link">{content}</span>}
          {step.hint && <span className="step-hint">{step.hint}</span>}
        </li>
      })}
    </ol>
  </nav>
}
