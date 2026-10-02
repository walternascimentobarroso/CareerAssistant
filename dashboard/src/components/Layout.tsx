import { NavLink, Outlet } from 'react-router'
import { useApplications } from '../data/loadApplications'
import { ParseErrors } from './ParseErrors'

export function Layout() {
  const { errors, loading, error, reload } = useApplications()
  return (
    <>
      <header className="topbar">
        <span className="brand">Career Assistant</span>
        <nav>
          <NavLink to="/" end>
            Board
          </NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/cvs">CVs</NavLink>
        </nav>
      </header>
      <main>
        <ParseErrors errors={errors} />
        <button onClick={() => void reload().catch(() => {})}>Reload files</button>
        {error && <p role="alert">{error}</p>}
        {loading ? <p>Loading files…</p> : <Outlet />}
      </main>
    </>
  )
}
