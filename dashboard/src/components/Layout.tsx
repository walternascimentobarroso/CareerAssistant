import { NavLink, Outlet } from 'react-router'
import { useApplications } from '../data/loadApplications'

export function Layout() {
  const { loading, error, reload } = useApplications()
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
          <NavLink to="/messages">Messages</NavLink>
          <NavLink to="/new">New application</NavLink>
          <NavLink to="/profile">Personal profile</NavLink>
          <NavLink to="/knowledge">Knowledge Base</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          <NavLink to="/trash">Trash</NavLink>
        </nav>
      </header>
      <main>
        <button onClick={() => void reload().catch(() => {})}>Refresh</button>
        {error && <p role="alert">{error}</p>}
        {loading ? <p>Loading applications…</p> : <Outlet />}
      </main>
    </>
  )
}
