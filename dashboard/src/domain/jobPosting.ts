import { z } from 'zod'

export const CAPTURE_METHODS = ['json_ld', 'html', 'text'] as const
export type CaptureMethod = (typeof CAPTURE_METHODS)[number]

/** What `POST /api/job-postings/fetch` returns: text to review, never saved by the import itself. */
export type FetchedJobPosting = {
  text: string
  requestedUrl: string
  resolvedUrl: string
  capturedAt: string
  method: CaptureMethod
}

/** How a stored description got its text. Absent on legacy records, whose origin is unknown. */
export type JobPostingProvenance = {
  inputKind: 'manual' | 'url'
  capturedAt: string
  resolvedUrl?: string
  method?: CaptureMethod
  edited?: boolean
}

const httpUrl = z.string().max(4096).refine((value) => /^https?:\/\//i.test(value) && URL.canParse(value), 'expected an http(s) URL')

// A manual entry cannot claim an import's method or destination; the server stamps its instant.
export const jobPostingCaptureSchema = z.discriminatedUnion('inputKind', [
  z.strictObject({ inputKind: z.literal('manual') }),
  z.strictObject({
    inputKind: z.literal('url'),
    sourceUrl: httpUrl,
    resolvedUrl: httpUrl,
    capturedAt: z.iso.datetime({ offset: true }),
    method: z.enum(CAPTURE_METHODS),
    edited: z.boolean(),
  }),
])

export type JobPostingCapture = z.infer<typeof jobPostingCaptureSchema>

export function describeProvenance(provenance: JobPostingProvenance) {
  const when = new Date(provenance.capturedAt).toLocaleString()
  if (provenance.inputKind === 'manual') return `Entered manually on ${when}.`
  return `Imported from ${provenance.resolvedUrl} on ${when}${provenance.edited ? ', then edited' : ''}.`
}
