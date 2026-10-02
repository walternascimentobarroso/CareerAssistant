import { useEffect } from 'react'

const DISCARD_QUESTION = 'Discard unsaved changes?'

export function confirmDiscard(dirty: boolean) {
  return !dirty || window.confirm(DISCARD_QUESTION)
}

/** Warns before a link click or a tab close throws away unsaved form content. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    const navigate = (e: MouseEvent) => {
      if (dirty && e.target instanceof Element && e.target.closest('a[href]') && !window.confirm(DISCARD_QUESTION)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', navigate, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', navigate, true) }
  }, [dirty])
}
