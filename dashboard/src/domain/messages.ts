import { stringify } from 'yaml'
import { z } from 'zod'
import { splitFrontmatter } from './frontmatter'

// Strict on purpose, like the application schema: a typo must fail instead of being dropped.
export const messageSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
})

export type Message = { slug: string; title: string; content: string }

export type MessageError = { slug: string; issues: string[] }

/** `files` maps the file name without `.md` (the slug) to its content. */
export function buildMessages(files: Record<string, string>) {
  const messages: Message[] = []
  const errors: MessageError[] = []

  for (const [slug, markdown] of Object.entries(files)) {
    const parsed = parseMessage(markdown)
    if ('issues' in parsed) errors.push({ slug, issues: parsed.issues })
    else messages.push({ slug, ...parsed })
  }

  return { messages: messages.sort((a, b) => a.title.localeCompare(b.title)), errors }
}

function parseMessage(markdown: string): { title: string; content: string } | { issues: string[] } {
  try {
    const { frontmatter, body } = splitFrontmatter(markdown)
    const validation = messageSchema.safeParse(frontmatter)
    if (validation.success) return { title: validation.data.title, content: body }
    return {
      issues: validation.error.issues.map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`),
    }
  } catch (error) {
    return { issues: [`invalid frontmatter: ${(error as Error).message}`] }
  }
}

export function serializeMessage(title: string, content: string) {
  return `---\n${stringify({ title: title.trim() })}---\n\n${content.trim()}\n`
}
