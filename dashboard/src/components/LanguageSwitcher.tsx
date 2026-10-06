import { useTranslation } from 'react-i18next'
import { LANGUAGES } from '../i18n'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  return <div role="group" aria-label="Language">
    {LANGUAGES.map(language => {
      const active = i18n.resolvedLanguage === language
      return <button key={language} type="button" className={active ? 'active' : undefined} aria-pressed={active} style={{ fontWeight: active ? 'bold' : 'normal' }}
        onClick={() => void i18n.changeLanguage(language)}>{language.toUpperCase()}</button>
    })}
  </div>
}
