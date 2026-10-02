import { Link } from 'react-router'
import type { Application } from '../domain/applications'
import { formatRate } from '../domain/format'
import { Badges } from './Badges'
import { NextActionBox } from './NextActionBox'

export function ApplicationCard({ application }: { application: Application }) {
  const { company, role, rate, next_action } = application.data
  const amount = rate?.requested ?? rate?.minimum

  return (
    <Link to={`/applications/${application.slug}`} className="card">
      <span className="card-company">{company}</span>
      <span className="card-role">{role}</span>
      <Badges data={application.data} />
      {rate && amount !== undefined && <span className="card-rate">{formatRate(amount, rate)}</span>}
      {next_action && <NextActionBox action={next_action} />}
    </Link>
  )
}
