import { randomUUID } from 'node:crypto'
import type { Browser, Page } from 'playwright'
import { StoreError } from './store.ts'

export type FormSnapshot = {
  applicationId: string; applicationRevision: string; preparationId: string; preparationRevision: string
  jobId: string; jobRevision: string; applyUrl: string; cvVersionId: string | null
}
export type FormSession = {
  page: Page; browser: Browser; expiresAt: number; state: 'inspected' | 'submitting' | 'submitted' | 'uncertain'
  formSelector: string; snapshot?: FormSnapshot; timer: ReturnType<typeof setTimeout>
}
export const sessions = new Map<string, FormSession>()
export function createSession(page: Page, browser: Browser, formSelector: string, ttl = 600_000) {
  const id = randomUUID()
  const timer = setTimeout(() => { void closeSession(id) }, ttl)
  timer.unref()
  sessions.set(id, { page, browser, formSelector, timer, expiresAt: Date.now() + ttl, state: 'inspected' })
  return id
}
export function getSession(id: string) {
  const session = sessions.get(id)
  if (!session || session.expiresAt <= Date.now()) {
    void closeSession(id)
    throw new StoreError(404, 'Form session missing or expired. Inspect the form again.')
  }
  return session
}
export async function closeSession(id: string) {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  clearTimeout(session.timer)
  await session.browser.close().catch(() => {})
}
