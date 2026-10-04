import type { ApplicationData } from './schema'

export type Interview = { id?:string; slug: string; title: string; documents: string[]; status?:string; date?:string; participants?:{name:string;role:string|null}[] }

export type Application = {
  slug: string
  data: ApplicationData
  notes: string
  /** Documents keyed by their display path, e.g. `job-description.md` or `interviews/01-recruiter/summary.md`. */
  documents: Record<string, string>
  interviews: Interview[]
}
