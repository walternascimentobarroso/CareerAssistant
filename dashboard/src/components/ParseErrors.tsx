import type { ApplicationError } from '../domain/applications'

export function ParseErrors({ errors }: { errors: ApplicationError[] }) {
  if (errors.length === 0) return null

  return (
    <section className="parse-errors">
      <strong>
        {errors.length} application(s) could not be read and are hidden. Fix the Markdown or run <code>npm run validate</code>.
      </strong>
      {errors.map(({ slug, issues }) => (
        <div key={slug}>
          <code>applications/{slug}</code>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
