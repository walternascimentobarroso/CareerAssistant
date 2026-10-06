import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import { useApplications } from '../data/loadApplications'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Layout() {
  const { t } = useTranslation('common')
  const { loading, error, reload } = useApplications()
  return (
    <>
      <header className="topbar">
        <span className="brand">{t('brand')}</span>
        <nav>
          <NavLink to="/" end>
            {t('board')}
          </NavLink>
          <NavLink to="/tasks">{t('tasks')}</NavLink>
          <NavLink to="/cvs">{t('cvs')}</NavLink>
          <NavLink to="/messages">{t('messages')}</NavLink>
          <NavLink to="/new">{t('new_application')}</NavLink>
          <NavLink to="/profile">{t('personal_profile')}</NavLink>
          <NavLink to="/knowledge">{t('knowledge_base')}</NavLink>
          <NavLink to="/settings">{t('settings')}</NavLink>
          <NavLink to="/trash">{t('trash')}</NavLink>
        </nav>
        <LanguageSwitcher />
      </header>
      <main>
        <button onClick={() => void reload().catch(() => {})}>{t('refresh')}</button>
        {error && <p role="alert">{error}</p>}
        {loading ? <p>{t('loading_applications')}</p> : <Outlet />}
      </main>
    </>
  )
}
