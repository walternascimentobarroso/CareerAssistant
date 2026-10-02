import { ApplicationsProvider } from './data/loadApplications'
import { CvPage } from './pages/CvPage'
import { HashRouter, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { ApplicationPage } from './pages/ApplicationPage'
import { DocumentPage } from './pages/DocumentPage'
import { KanbanPage } from './pages/KanbanPage'
import { TasksPage } from './pages/TasksPage'

export function App() {
  return (
    <ApplicationsProvider><HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<KanbanPage />} />
          <Route path="cvs" element={<CvPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="applications/:slug" element={<ApplicationPage />} />
          <Route path="applications/:slug/doc/*" element={<DocumentPage />} />
        </Route>
      </Routes>
    </HashRouter></ApplicationsProvider>
  )
}
