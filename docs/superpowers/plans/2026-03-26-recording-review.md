# 録画後レビュー機能 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 録画停止直後に「▶ 再生」ボタンを追加し、タップするとその録画をモーダルで確認できるようにする。

**Architecture:** `useRecorder` に `blobRef` を公開し、`RecordPage` にモーダル状態（`isReviewing` / `reviewUrl`）を追加する。モーダルは `VideoReviewModal` コンポーネントとして同ディレクトリに切り出す。

**Tech Stack:** React 18, TypeScript, CSS Modules, Vite, Vitest

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `teleprompter-app/src/hooks/useRecorder.ts` | `blobRef` を `UseRecorderResult` に追加して公開 |
| Create | `teleprompter-app/src/components/VideoReviewModal.tsx` | 動画再生モーダルコンポーネント |
| Create | `teleprompter-app/src/components/VideoReviewModal.module.css` | モーダルのスタイル |
| Modify | `teleprompter-app/src/pages/RecordPage.tsx` | `blobRef` 取得・モーダル状態追加・「▶ 再生」ボタン追加 |

---

## Chunk 1: useRecorder に blobRef を公開

### Task 1: `UseRecorderResult` に `blobRef` を追加する

**Files:**
- Modify: `teleprompter-app/src/hooks/useRecorder.ts:5-11,95`

- [ ] **Step 1: `UseRecorderResult` インターフェースに `blobRef` を追加**

`teleprompter-app/src/hooks/useRecorder.ts` の `UseRecorderResult` を以下に変更:

```ts
import { useRef, useState, type RefObject } from 'react'

export type RecordState = 'idle' | 'recording' | 'stopped'

interface UseRecorderResult {
  state: RecordState
  startRecording: (stream: MediaStream) => void
  stopRecording: () => void
  shareOrDownload: (filename: string) => Promise<void>
  reset: () => void
  blobRef: RefObject<Blob | null>
}
```

- [ ] **Step 2: return 文に `blobRef` を追加**

`useRecorder.ts` の line 95 を変更:

```ts
return { state, startRecording, stopRecording, shareOrDownload, reset, blobRef }
```

- [ ] **Step 3: TypeScript エラーがないか確認**

```bash
cd /Users/yujioyama/Site/teleprompter/teleprompter-app && npx tsc --noEmit
```

Expected: エラーなし（または新しいエラーなし）

- [ ] **Step 4: Commit**

```bash
git add teleprompter-app/src/hooks/useRecorder.ts
git commit -m "feat: expose blobRef from useRecorder"
```

---

## Chunk 2: VideoReviewModal コンポーネント

### Task 2: モーダルコンポーネントを作成する

**Files:**
- Create: `teleprompter-app/src/components/VideoReviewModal.tsx`
- Create: `teleprompter-app/src/components/VideoReviewModal.module.css`

- [ ] **Step 1: `VideoReviewModal.tsx` を作成**

```tsx
import styles from './VideoReviewModal.module.css'

interface Props {
  url: string
  onClose: () => void
}

export default function VideoReviewModal({ url, onClose }: Props) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <video
          className={styles.video}
          src={url}
          controls
          playsInline
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `VideoReviewModal.module.css` を作成**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  position: relative;
  width: min(92vw, 480px);
  background: var(--surface);
  border-radius: 16px;
  overflow: hidden;
}

.closeBtn {
  position: absolute;
  top: 10px;
  right: 12px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.video {
  width: 100%;
  display: block;
  max-height: 70vh;
  object-fit: contain;
  background: #000;
}
```

- [ ] **Step 3: TypeScript エラーがないか確認**

```bash
cd /Users/yujioyama/Site/teleprompter/teleprompter-app && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add teleprompter-app/src/components/VideoReviewModal.tsx teleprompter-app/src/components/VideoReviewModal.module.css
git commit -m "feat: add VideoReviewModal component"
```

---

## Chunk 3: RecordPage に「▶ 再生」ボタンとモーダル状態を追加

### Task 3: RecordPage にレビュー機能を組み込む

**Files:**
- Modify: `teleprompter-app/src/pages/RecordPage.tsx`

- [ ] **Step 1: import と state を追加**

`RecordPage.tsx` の先頭 import に追加:

```tsx
import VideoReviewModal from '../components/VideoReviewModal'
```

`useRecorder` の分割代入に `blobRef` を追加（line 18):

```tsx
const { state, startRecording, stopRecording, shareOrDownload, reset, blobRef } = useRecorder()
```

`shotIndex` state の直後に review state を追加:

```tsx
const [isReviewing, setIsReviewing] = useState(false)
const [reviewUrl, setReviewUrl] = useState<string | null>(null)
```

- [ ] **Step 2: `openModal` / `closeModal` 関数を追加**

`handleRetry` 関数の直前に追加:

```tsx
function openModal() {
  if (!blobRef.current) return
  try {
    const url = URL.createObjectURL(blobRef.current)
    setReviewUrl(url)
    setIsReviewing(true)
  } catch (err) {
    console.error('createObjectURL failed', err)
  }
}

function closeModal() {
  if (reviewUrl) {
    URL.revokeObjectURL(reviewUrl)
  }
  setReviewUrl(null)
  setIsReviewing(false)
}
```

- [ ] **Step 3: `handleRetry` を修正してメモリリークを防ぐ**

既存の `handleRetry` を以下に変更:

```tsx
function handleRetry() {
  closeModal()
  reset()
}
```

- [ ] **Step 4: `stoppedActions` に「▶ 再生」ボタンを追加**

`RecordPage.tsx` の `stopped` 状態の JSX を変更:

```tsx
{state === 'stopped' && (
  <div className={styles.stoppedActions}>
    <button className={styles.playBtn} onClick={openModal}>
      ▶ 再生
    </button>
    <button className={styles.saveBtn} onClick={handleSave}>
      📤 保存
    </button>
    <button className={styles.retryBtn} onClick={handleRetry}>
      もう一度
    </button>
    <button className={styles.nextBtn} onClick={handleNext}>
      {isLast ? '完了 ✓' : '次へ →'}
    </button>
  </div>
)}
```

- [ ] **Step 5: モーダルを JSX の末尾に追加**

`return (...)` の中、`backBtn` の後に追加:

```tsx
{isReviewing && reviewUrl && (
  <VideoReviewModal url={reviewUrl} onClose={closeModal} />
)}
```

- [ ] **Step 6: `RecordPage.module.css` に `.playBtn` スタイルを追加**

`RecordPage.module.css` の `.saveBtn` の前に追加:

```css
.playBtn {
  background: var(--surface2);
  color: var(--text);
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 700;
  border: 2px solid var(--accent);
}
```

- [ ] **Step 7: TypeScript エラーがないか確認**

```bash
cd /Users/yujioyama/Site/teleprompter/teleprompter-app && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 8: ビルドが通ることを確認**

```bash
cd /Users/yujioyama/Site/teleprompter/teleprompter-app && npm run build
```

Expected: `dist/` が生成される、エラーなし

- [ ] **Step 9: Commit**

```bash
git add teleprompter-app/src/pages/RecordPage.tsx teleprompter-app/src/pages/RecordPage.module.css
git commit -m "feat: add recording review modal to RecordPage"
```

---

## 手動テストチェックリスト

実装完了後、以下を実機 or ブラウザで確認:

- [ ] 録画停止後に「▶ 再生」ボタンが表示される
- [ ] 「▶ 再生」をタップするとモーダルが開く
- [ ] 動画が表示され、controls で手動再生できる（autoplay しない）
- [ ] ✕ ボタンでモーダルが閉じる
- [ ] モーダル外（オーバーレイ）タップでモーダルが閉じる
- [ ] モーダルを閉じた後、「保存」「もう一度」「次へ」ボタンが使える
- [ ] 「もう一度」をタップすると録画がリセットされ idle 状態に戻る
- [ ] 「もう一度」の後、「▶ 再生」ボタンが消えている

---

## Push

```bash
git push origin main
```
