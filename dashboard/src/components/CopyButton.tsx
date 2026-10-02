import { useState } from 'react'

const LABELS = { idle: 'Copy', copied: 'Copied ✓', failed: 'Copy failed' }

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<keyof typeof LABELS>('idle')
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState('copied') }
    catch { setState('failed') }
    setTimeout(() => setState('idle'), 2000)
  }
  return <button type="button" aria-live="polite" onClick={() => void copy()}>{LABELS[state]}</button>
}
