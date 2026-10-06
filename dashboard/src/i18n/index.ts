import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common.json'
import enPages from './locales/en/pages.json'
import enStatus from './locales/en/status.json'
import ptCommon from './locales/pt/common.json'
import ptPages from './locales/pt/pages.json'
import ptStatus from './locales/pt/status.json'

export const LANGUAGES = ['pt', 'en'] as const

void i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: {
    pt: { common: ptCommon, status: ptStatus, pages: ptPages },
    en: { common: enCommon, status: enStatus, pages: enPages },
  },
  fallbackLng: 'pt',
  supportedLngs: LANGUAGES,
  // Browser locales such as pt-BR or en-US resolve to the plain language.
  nonExplicitSupportedLngs: true,
  load: 'languageOnly',
  ns: ['common', 'status', 'pages'],
  defaultNS: 'common',
  detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
  interpolation: { escapeValue: false },
})

export default i18n
