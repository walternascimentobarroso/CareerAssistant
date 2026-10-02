import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { buildApplications } from '../dashboard/src/domain/applications'
import { buildMessages } from '../dashboard/src/domain/messages'

const APPLICATIONS_DIR = join(import.meta.dirname, '..', 'applications')
const MESSAGES_DIR = join(import.meta.dirname, '..', 'messages')

function readMarkdownFiles(): Record<string, string> {
  const paths = readdirSync(APPLICATIONS_DIR, { recursive: true, encoding: 'utf8' })
  return Object.fromEntries(
    paths
      .filter((path) => path.endsWith('.md'))
      .map((path) => [path.split(sep).join('/'), readFileSync(join(APPLICATIONS_DIR, path), 'utf8')]),
  )
}

function readMessageFiles(): Record<string, string> {
  if (!existsSync(MESSAGES_DIR)) return {}
  return Object.fromEntries(
    readdirSync(MESSAGES_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => [name.slice(0, -3), readFileSync(join(MESSAGES_DIR, name), 'utf8')]),
  )
}

const { applications, errors } = buildApplications(readMarkdownFiles())
const messages = buildMessages(readMessageFiles())

for (const { slug, issues } of errors) {
  console.error(`✖ applications/${slug}`)
  for (const issue of issues) console.error(`    ${issue}`)
}

for (const { slug, issues } of messages.errors) {
  console.error(`✖ messages/${slug}.md`)
  for (const issue of issues) console.error(`    ${issue}`)
}

console.log(`${applications.length} valid, ${errors.length} invalid`)
console.log(`${messages.messages.length} messages valid, ${messages.errors.length} invalid`)
process.exit(errors.length + messages.errors.length > 0 ? 1 : 0)
