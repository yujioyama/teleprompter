import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ScriptEditPage from './pages/ScriptEditPage'
import ShotEditPage from './pages/ShotEditPage'
import RecordPage from './pages/RecordPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/scripts/new" element={<ScriptEditPage />} />
      <Route path="/scripts/:id/edit" element={<ScriptEditPage />} />
      <Route path="/scripts/:id/shots" element={<ShotEditPage />} />
      <Route path="/scripts/:id/record" element={<RecordPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}
