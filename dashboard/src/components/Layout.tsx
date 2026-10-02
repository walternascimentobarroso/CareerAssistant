import { NavLink, Outlet } from 'react-router'
import { errors } from '../data/loadApplications'
import { ParseErrors } from './ParseErrors'

export function Layout() {
  return (
    <>
      <header className="topbar">
        <span className="brand">Career Assistant</span>
        <nav>
          <NavLink to="/" end>
            Board
          </NavLink>
          <NavLink to="/tasks">Tasks</NavLink>
        </nav>
      </header>
      <main>
        <ParseErrors errors={errors} />
        <Outlet />
      </main>
    </>
  )
}
