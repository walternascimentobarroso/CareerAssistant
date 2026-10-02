import { useEffect, useState } from 'react'
import { ModelPicker } from '../components/ModelPicker'
import { request, type AiSettings } from '../data/loadApplications'

export function SettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const show = (loaded: AiSettings) => { setSettings(loaded); setProvider(loaded.provider); setModel(loaded.model); setKeys({}) }
  useEffect(() => { void request<AiSettings>('/settings').then(show).catch(e => setMessage(e.message)) }, [])
  async function save() {
    setBusy(true); setMessage('')
    try {
      const newKeys = Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, key.trim()]).filter(([, key]) => key))
      show(await request<AiSettings>('/settings', 'PUT', { provider, ...(model.trim() && { model: model.trim() }), keys: newKeys }))
      setMessage('Saved.')
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function test(id: string, label: string) {
    setBusy(true); setMessage('')
    try { setMessage(`${label} key works: ${(await request<string[]>(`/models/${id}`)).length} models available.`) }
    catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  if (!settings) return <p role="status">{message || 'Loading settings…'}</p>
  return <article className="detail">
    <h1>Settings</h1>
    <p className="muted">Used to fill in a new application from the posting text. Stored in the .env file of this project, which Git ignores. Saved keys are never shown again.</p>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset>
        <legend>Default model</legend>
        <ModelPicker settings={settings} provider={provider} model={model} disabled={busy} onChange={(nextProvider, nextModel) => { setProvider(nextProvider); setModel(nextModel) }} />
        <p className="muted">Choose "Other…" to type a model that is not in the list.</p>
      </fieldset>
      <fieldset>
        <legend>API keys</legend>
        <div className="form-grid">
          {settings.providers.map(p => <div key={p.id} className="key-field">
            <label>{p.label} — {p.configured ? 'key saved' : 'no key yet'}<input type="password" autoComplete="off" value={keys[p.id] ?? ''} disabled={busy} placeholder={p.configured ? 'Paste a new key to replace it' : 'Paste your key'} onChange={e => setKeys({ ...keys, [p.id]: e.target.value })} /></label>
            <button type="button" disabled={busy || !p.configured} onClick={() => void test(p.id, p.label)}>Test saved key</button>
          </div>)}
        </div>
      </fieldset>
      <div className="toolbar"><button disabled={busy}>{busy ? 'Working…' : 'Save settings'}</button></div>
      <p role="status">{message}</p>
    </form>
  </article>
}
