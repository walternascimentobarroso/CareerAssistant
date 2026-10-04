import { parseEnv } from 'node:util'
import { CONTRACT_TYPES, RATE_PERIODS } from '../dashboard/src/domain/constants.ts'
import { suggestionSchema } from '../dashboard/src/domain/suggestion.ts'
import { StoreError, revision, type Store } from './store.ts'

export const PROVIDERS = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyVariable: 'GROQ_API_KEY', defaultModel: 'openai/gpt-oss-120b' },
  gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyVariable: 'GEMINI_API_KEY', defaultModel: 'gemini-flash-lite-latest' },
} as const
export type ProviderId = keyof typeof PROVIDERS
export const PROVIDER_IDS = Object.keys(PROVIDERS) as [ProviderId, ...ProviderId[]]
const DEFAULT_PROVIDER: ProviderId = 'groq'
const ENV_FILE = '.env'
// Providers list speech, image and safety models next to chat models without saying which is which.
const NOT_A_CHAT_MODEL = /whisper|tts|guard|embedding|image|veo|lyria|live|audio|orpheus|transcribe|robotics|computer-use|aqa/i

const INSTRUCTIONS = `You extract structured data from a job posting. Reply with one JSON object and nothing else, using exactly these keys:
- company: hiring company name
- role: job title
- location: city, country or "Remote" as written
- job_url: link to the posting, only if it appears in the text
- type: one of ${CONTRACT_TYPES.join(', ')}
- rate: { requested: decimal string, minimum: decimal string, currency: 3-letter code, period: one of ${RATE_PERIODS.join(', ')}, vat: boolean }. For a salary range, requested is the top and minimum is the bottom.
- contact: { name, role, email, phone, linkedin } of the recruiter or hiring contact
- tags: lowercase technologies and keywords, at most 12
- keyRequirements: mandatory requirements, one short sentence each
- niceToHave: optional or preferred requirements
- technologies: every technology, language, framework and tool named
Use only what the text states. Never guess: when something is not in the text, use null (or an empty array for lists). Keep the posting's own language for sentences.`

function updateEnv(content: string, values: Record<string, string | undefined>) {
  const lines = content === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/)
  for (const [name, value] of Object.entries(values)) {
    const index = lines.findIndex(line => line.startsWith(`${name}=`))
    if (value === undefined) { if (index !== -1) lines.splice(index, 1) }
    else if (index === -1) lines.push(`${name}=${value}`)
    else lines[index] = `${name}=${value}`
  }
  return lines.join('\n') + '\n'
}

export class Ai {
  private store: Pick<Store, 'read' | 'write'>
  private fetcher: typeof fetch
  constructor(store: Pick<Store, 'read' | 'write'>, fetcher: typeof fetch = fetch) {
    this.store = store
    this.fetcher = fetcher
  }
  private envFile() {
    try { return this.store.read(ENV_FILE) }
    catch (error) {
      if (error instanceof StoreError && error.status === 404) return null
      throw error
    }
  }
  private env() { return parseEnv(this.envFile() ?? '') }
  settings() {
    const env = this.env()
    const provider = PROVIDER_IDS.find(id => id === env.AI_PROVIDER) ?? DEFAULT_PROVIDER
    return {
      provider,
      model: env.AI_MODEL || PROVIDERS[provider].defaultModel,
      // Keys stay on the server; the browser only learns whether one exists.
      providers: PROVIDER_IDS.map(id => ({ id, label: PROVIDERS[id].label, defaultModel: PROVIDERS[id].defaultModel, configured: !!env[PROVIDERS[id].keyVariable] })),
    }
  }
  saveSettings(input: { provider: ProviderId; model?: string; keys?: Partial<Record<ProviderId, string>> }) {
    const current = this.envFile()
    const values: Record<string, string | undefined> = { AI_PROVIDER: input.provider, AI_MODEL: input.model }
    for (const id of PROVIDER_IDS) if (input.keys?.[id]) values[PROVIDERS[id].keyVariable] = input.keys[id]
    this.store.write(ENV_FILE, updateEnv(current ?? '', values), current === null ? null : revision(current))
    return this.settings()
  }
  private async call(id: ProviderId, path: string, body?: unknown) {
    const provider = PROVIDERS[id]
    const key = this.env()[provider.keyVariable]
    if (!key) throw new StoreError(400, `${provider.label} has no API key. Add one in Settings.`)
    let response: Response
    try {
      response = await this.fetcher(provider.baseUrl + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      throw new StoreError(502, timedOut ? `${provider.label} did not answer within 60 seconds.` : `${provider.label} could not be reached.`)
    }
    const value = await response.json().catch(() => null)
    if (!response.ok) {
      const error = (Array.isArray(value) ? value[0] : value)?.error
      throw new StoreError(502, `${provider.label}: ${error?.message ?? `request failed (${response.status})`}`)
    }
    return value
  }
  async models(id: ProviderId) {
    const listed = await this.call(id, '/models') as { data?: { id: string }[] }
    return (listed.data ?? []).map(model => model.id.replace(/^models\//, '')).filter(name => !NOT_A_CHAT_MODEL.test(name)).sort()
  }
  async extract(input: { text: string; provider?: ProviderId; model?: string }) {
    const settings = this.settings()
    const provider = input.provider ?? settings.provider
    const model = input.model || (provider === settings.provider ? settings.model : PROVIDERS[provider].defaultModel)
    const completion = await this.call(provider, '/chat/completions', {
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: INSTRUCTIONS }, { role: 'user', content: input.text }],
    }) as { choices?: { message?: { content?: string } }[] }
    const answer = completion.choices?.[0]?.message?.content ?? ''
    // Some models wrap the object in prose or a code fence despite the instructions.
    const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)
    let parsed: unknown
    try { parsed = JSON.parse(json) } catch { throw new StoreError(502, `${PROVIDERS[provider].label} (${model}) did not return usable data. Try again or pick another model.`) }
    const suggestion = suggestionSchema.safeParse(parsed)
    if (!suggestion.success) throw new StoreError(502, `${PROVIDERS[provider].label} (${model}) did not return usable data. Try again or pick another model.`)
    return { provider, model, suggestion: suggestion.data }
  }
}
