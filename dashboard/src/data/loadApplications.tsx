import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Application, ApplicationError } from '../domain/applications'
import type { Message } from '../domain/messages'
export type LiveApplication = Application & { revision: string }
export type LiveMessage = Message & { revision: string }
export type Cv = { name: string; content: string; revision: string }
export type AiProvider = { id: string; label: string; defaultModel: string; configured: boolean }
export type AiSettings = { provider: string; model: string; providers: AiProvider[] }
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? 'Request failed')
  return value as T
}
export async function revisionOf(content: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
type State = { applications: LiveApplication[]; errors: ApplicationError[]; loading: boolean; error: string; reload: () => Promise<void>; findApplication: (slug: string | undefined) => LiveApplication | undefined }
const Context = createContext<State | null>(null)
export function ApplicationsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<{ applications: LiveApplication[]; errors: ApplicationError[] }>({ applications: [], errors: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try { setData(await request('/applications')); setError('') }
    catch (e) { setError((e as Error).message); throw e }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    const refresh = () => { void reload().catch(() => {}) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [reload])
  return <Context.Provider value={{ ...data, loading, error, reload, findApplication: slug => data.applications.find(a => a.slug === slug) }}>{children}</Context.Provider>
}
export function useApplications() {
  const state = useContext(Context)
  if (!state) throw new Error('ApplicationsProvider missing')
  return state
}
