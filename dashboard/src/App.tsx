import { ApplicationsProvider } from './data/loadApplications'
import { TrashPage } from './pages/TrashPage'
import { CvPage } from './pages/CvPage'
import { HashRouter, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { ApplicationPage } from './pages/ApplicationPage'
import { DocumentPage } from './pages/DocumentPage'
import { EditApplicationPage } from './pages/EditApplicationPage'
import { JobDescriptionPage } from './pages/JobDescriptionPage'
import { KanbanPage } from './pages/KanbanPage'
import { MessagesPage } from './pages/MessagesPage'
import { NewApplicationPage } from './pages/NewApplicationPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'

export function App() {
  return (
    <ApplicationsProvider><HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<KanbanPage />} />
          <Route path="cvs" element={<CvPage />} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="new" element={<NewApplicationPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="applications/:slug" element={<ApplicationPage />} />
          <Route path="applications/:slug/edit" element={<EditApplicationPage />} />
          <Route path="applications/:slug/job-description" element={<JobDescriptionPage />} />
          <Route path="applications/:slug/doc/*" element={<DocumentPage />} />
        </Route>
      </Routes>
    </HashRouter></ApplicationsProvider>
  )
}
