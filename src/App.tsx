import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ScriptEditPage from './pages/ScriptEditPage'
import ShotEditPage from './pages/ShotEditPage'
import SettingsPage from './pages/SettingsPage'
import LoadErrorBoundary from './components/LoadErrorBoundary'
import UpdateNotice from './components/UpdateNotice'

// Split out so the home/script-editing screens don't download the video
// pipeline (Mediabunny, the ffmpeg.wasm wrapper) before it's needed.
const loadRecordPage = () => import('./pages/RecordPage')
const loadFinalizePage = () => import('./pages/FinalizePage')
const RecordPage = lazy(loadRecordPage)
const FinalizePage = lazy(loadFinalizePage)

// How long after opening those screens' code is fetched anyway, so the
// service worker has it for a launch without a network.
const WARM_UP_DELAY_MS = 5000

export default function App() {
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only a head start: a screen that fails to load says so when opened.
      void loadRecordPage().catch(() => undefined)
      void loadFinalizePage().catch(() => undefined)
    }, WARM_UP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <LoadErrorBoundary>
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
      <UpdateNotice />
    </LoadErrorBoundary>
  )
}
