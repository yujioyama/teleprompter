# 録画後レビュー機能 設計書

**Date:** 2026-03-26
**Status:** Approved

---

## 概要

録画停止直後に、そのショットを再生して確認できるモーダルを追加する。ユーザーは映像を確認した上で、撮り直しか次のショットへの進行かを判断できる。

---

## スコープ

- 対象ページ: `RecordPage.tsx`
- 変更ファイル: `RecordPage.tsx`（新コンポーネント追加も含む）、`useRecorder.ts`（`blobRef` の公開のみ）
- 変更しないもの: ルーティング、localStorage/sessionStorage

---

## UI / フロー

### 録画停止後のボタン構成

**変更前:**
```
📤 保存  |  🔄 もう一度  |  次へ →
```

**変更後:**
```
▶ 再生  |  📤 保存  |  🔄 もう一度  |  次へ →
```

### モーダル

- 「▶ 再生」ボタンをタップするとモーダルが開く
- モーダル内に `<video>` 要素を表示（autoplay なし、手動再生）
- 右上に ✕ ボタンでモーダルを閉じる
- モーダル外タップでも閉じる
- モーダルを閉じてもボタン構成はそのまま（再生・保存・撮り直し・次へ）

---

## 実装詳細

### 状態管理

`RecordPage.tsx` に以下の state を追加:

```ts
const [isReviewing, setIsReviewing] = useState(false)
const [reviewUrl, setReviewUrl] = useState<string | null>(null)
```

### 再生フロー

1. 「▶ 再生」押下 → `URL.createObjectURL(blobRef.current)` で URL 生成
2. `setReviewUrl(url)` + `setIsReviewing(true)` でモーダル表示
3. モーダル内の `<video src={reviewUrl}>` で再生
4. モーダルを閉じる → `URL.revokeObjectURL(reviewUrl)` でメモリ解放 → `setReviewUrl(null)` + `setIsReviewing(false)`

### Blob の取得元

`useRecorder` の `UseRecorderResult` に `blobRef: React.RefObject<Blob | null>` を追加して公開する。録画停止後は `blobRef.current` に Blob が入っている。これが `useRecorder.ts` への唯一の変更点。

---

## コンポーネント設計

### VideoReviewModal

新規コンポーネントとして `RecordPage.tsx` 内（または同ディレクトリの別ファイル）に実装。

```
props:
  url: string        // objectURL
  onClose: () => void
```

内部構成:
- オーバーレイ背景（タップで閉じる）
- `<video>` 要素（controls あり、autoplay なし）
- ✕ ボタン

---

## エラーハンドリング

- `blobRef.current` が null の場合（録画前など）は「▶ 再生」ボタンを非表示にする（stopped 状態のみ表示するので通常発生しない）
- `createObjectURL` 失敗時は console.error のみ（UI には影響させない）

---

## 既存機能への影響

| 機能 | 影響 |
|------|------|
| 📤 保存 | なし（ボタンはそのまま残す） |
| 🔄 もう一度（撮り直し） | `handleRetry` は必ず `closeModal()`（`revokeObjectURL` を含む）を先に呼んでから `reset()` を呼ぶ。順序が逆になるとメモリリークになる。 |
| 次へ → | なし |
| useRecorder フック | `blobRef` を `UseRecorderResult` に追加して公開（それ以外は変更なし） |

---

## テスト観点

- 録画停止後に「▶ 再生」ボタンが表示される
- ボタンを押すとモーダルが開き動画が表示される
- 手動で再生できる（autoplay しない）
- ✕ ボタン / 背景タップでモーダルが閉じる
- モーダルを閉じた後も「保存」「撮り直し」「次へ」ボタンが使える
- 「もう一度」を押すと録画がリセットされ「▶ 再生」ボタンが消える
