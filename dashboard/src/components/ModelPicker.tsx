import { useEffect, useState } from 'react'
import { request, type AiSettings } from '../data/loadApplications'

const OTHER = 'other'

type Props = { settings: AiSettings; provider: string; model: string; disabled: boolean; onChange: (provider: string, model: string) => void }

export function ModelPicker({ settings, provider, model, disabled, onChange }: Props) {
  const [models, setModels] = useState<string[]>([])
  const [typing, setTyping] = useState(false)
  const configured = settings.providers.find(p => p.id === provider)?.configured
  useEffect(() => {
    setModels([])
    if (!configured) return
    let current = true
    // When the list cannot be loaded the current model and "Other…" are still offered.
    void request<string[]>(`/models/${provider}`).then(list => { if (current) setModels(list) }).catch(() => {})
    return () => { current = false }
  }, [provider, configured])
  function chooseProvider(id: string) {
    const chosen = settings.providers.find(p => p.id === id)
    setTyping(false)
    onChange(id, id === settings.provider ? settings.model : chosen?.defaultModel ?? '')
  }
  const listed = !model || models.includes(model) ? models : [model, ...models]
  return <div className="form-grid">
    <label>AI provider<select value={provider} disabled={disabled} onChange={e => chooseProvider(e.target.value)}>
      {settings.providers.map(p => <option key={p.id} value={p.id}>{p.label}{p.configured ? '' : ' (no key)'}</option>)}
    </select></label>
    <label>Model<select value={typing ? OTHER : model} disabled={disabled} onChange={e => {
      setTyping(e.target.value === OTHER)
      if (e.target.value !== OTHER) onChange(provider, e.target.value)
    }}>
      {listed.map(name => <option key={name} value={name}>{name}</option>)}
      <option value={OTHER}>Other…</option>
    </select></label>
    {typing && <label>Model name<input autoFocus value={model} disabled={disabled} placeholder="Exactly as the provider names it" onChange={e => onChange(provider, e.target.value)} /></label>}
  </div>
}
