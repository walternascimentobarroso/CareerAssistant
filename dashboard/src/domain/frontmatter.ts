import { parse } from 'yaml'

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function splitFrontmatter(markdown: string): { frontmatter: unknown; body: string } {
  const match = markdown.match(FRONTMATTER_BLOCK)
  if (!match) throw new Error('missing YAML frontmatter block delimited by ---')
  return { frontmatter: parse(match[1]), body: match[2].trim() }
}
