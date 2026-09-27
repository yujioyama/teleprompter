import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ScriptEditPage from './pages/ScriptEditPage'
import ShotEditPage from './pages/ShotEditPage'
import SettingsPage from './pages/SettingsPage'

// Split out so the home/script-editing screens don't download the video
// pipeline (Mediabunny, the ffmpeg.wasm wrapper) before it's needed.
const RecordPage = lazy(() => import('./pages/RecordPage'))
const FinalizePage = lazy(() => import('./pages/FinalizePage'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/scripts/new" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/edit" element={<ScriptEditPage />} />
        <Route path="/scripts/:id/shots" element={<ShotEditPage />} />
        <Route path="/scripts/:id/record" element={<RecordPage />} />
        <Route path="/scripts/:id/finalize" element={<FinalizePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Suspense>
  )
}
