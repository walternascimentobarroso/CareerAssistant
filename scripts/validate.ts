import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { buildApplications } from '../dashboard/src/domain/applications'

const APPLICATIONS_DIR = join(import.meta.dirname, '..', 'applications')

function readMarkdownFiles(): Record<string, string> {
  const paths = readdirSync(APPLICATIONS_DIR, { recursive: true, encoding: 'utf8' })
  return Object.fromEntries(
    paths
      .filter((path) => path.endsWith('.md'))
      .map((path) => [path.split(sep).join('/'), readFileSync(join(APPLICATIONS_DIR, path), 'utf8')]),
  )
}

const { applications, errors } = buildApplications(readMarkdownFiles())

for (const { slug, issues } of errors) {
  console.error(`✖ applications/${slug}`)
  for (const issue of issues) console.error(`    ${issue}`)
}

console.log(`${applications.length} valid, ${errors.length} invalid`)
process.exit(errors.length > 0 ? 1 : 0)
