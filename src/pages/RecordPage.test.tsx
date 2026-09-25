import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { IDBFactory } from 'fake-indexeddb'
import RecordPage from './RecordPage'
import { Script } from '../types'

vi.mock('../utils/processRecordedVideo', async () => {
  const actual = await vi.importActual<typeof import('../utils/processRecordedVideo')>(
    '../utils/processRecordedVideo'
  )
  return {
    ...actual,
    processRecordedVideo: vi.fn(async (raw: Blob) => ({ blob: raw, ok: true, error: null })),
  }
})

const SHOT_1 = '11111111-1111-1111-1111-111111111111'
const SHOT_2 = '22222222-2222-2222-2222-222222222222'
const SHOT_3 = '33333333-3333-3333-3333-333333333333'

function seedScript(): Script {
  const script: Script = {
    id: 'script-1',
    title: 'テスト動画',
    shots: [
      { id: SHOT_1, text: 'ショット1' },
      { id: SHOT_2, text: 'ショット2' },
      { id: SHOT_3, text: 'ショット3' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem('teleprompter_scripts', JSON.stringify([script]))
  return script
}

function videoFile(name: string) {
  return new File(['x'], name, { type: 'video/quicktime' })
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

function renderRecordPage(scriptId: string) {
  render(
    <MemoryRouter initialEntries={[`/scripts/${scriptId}/record`]}>
      <Routes>
        <Route path="/scripts/:id/record" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.clearAllMocks()
  // jsdom doesn't implement Element.scrollTo; RecordPage calls it on an
  // effect-scroll ref whenever `state` is 'idle'.
  Element.prototype.scrollTo = vi.fn()
})

describe('RecordPage bulk import from teleprompter-cam', () => {
  it('imports every matching file and shows the finish screen once all shots are covered', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot2of3-${SHOT_2}.mov`),
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile(`TeleprompterCam-abc-shot3of3-${SHOT_3}.mov`),
    ])

    expect(await screen.findByText('撮影完了！')).toBeInTheDocument()
    expect(screen.getByText('🎬 動画を仕上げる')).toBeInTheDocument()
  })

  it('imports the matching subset and lands on the next shot missing a video', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`)])

    await waitFor(() => {
      expect(screen.getByText('2 / 3 ≡')).toBeInTheDocument()
    })
  })

  it('shows an error and saves nothing when one of several files does not match any shot', async () => {
    const script = seedScript()
    renderRecordPage(script.id)

    const input = screen.getByLabelText('録画した動画をインポート') as HTMLInputElement
    selectFiles(input, [
      videoFile(`TeleprompterCam-abc-shot1of3-${SHOT_1}.mov`),
      videoFile('IMG_1234.MOV'),
    ])

    expect(
      await screen.findByText(/一致しないファイルがあります: IMG_1234\.MOV/)
    ).toBeInTheDocument()
    expect(screen.getByText('1 / 3 ≡')).toBeInTheDocument()
  })
})
