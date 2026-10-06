import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { ModelPicker } from '../components/ModelPicker'
import { request, type AiSettings } from '../data/loadApplications'

export function SettingsPage() {
  const { t } = useTranslation('pages')
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
      setMessage(t('settings.saved'))
    } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  async function test(id: string, label: string) {
    setBusy(true); setMessage('')
    try { setMessage(t('settings.key_works', { label, count: (await request<string[]>(`/models/${id}`)).length })) }
    catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  if (!settings) return <p role="status">{message || t('settings.loading_settings')}</p>
  return <article className="detail">
    <h1>{t('settings.settings')}</h1>
    <p className="muted">{t('settings.storage_hint')}</p>
    <form className="application-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset>
        <legend>{t('settings.default_model')}</legend>
        <ModelPicker settings={settings} provider={provider} model={model} disabled={busy} onChange={(nextProvider, nextModel) => { setProvider(nextProvider); setModel(nextModel) }} />
        <p className="muted">{t('settings.choose_other_to_type_a_model_that_is_not_in_the_list')}</p>
      </fieldset>
      <fieldset>
        <legend>{t('settings.api_keys')}</legend>
        <div className="form-grid">
          {settings.providers.map(p => <div key={p.id} className="key-field">
            <label>{p.label} — {p.configured ? t('settings.key_saved') : t('settings.no_key_yet')}<input type="password" autoComplete="off" value={keys[p.id] ?? ''} disabled={busy} placeholder={p.configured ? t('settings.paste_a_new_key_to_replace_it') : t('settings.paste_your_key')} onChange={e => setKeys({ ...keys, [p.id]: e.target.value })} /></label>
            <button type="button" disabled={busy || !p.configured} onClick={() => void test(p.id, p.label)}>{t('settings.test_saved_key')}</button>
          </div>)}
        </div>
      </fieldset>
      <div className="toolbar"><button disabled={busy}>{busy ? t('settings.working') : t('settings.save_settings')}</button></div>
      <p role="status">{message}</p>
    </form>
  </article>
}
