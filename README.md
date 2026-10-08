# Teleprompter App

**SNS動画撮影のために作った、ショット分割録画型テレプロンプターPWAです。**

[![Demo](https://img.shields.io/badge/Demo-teleprompter--mauve.vercel.app-blue)](https://teleprompter-mauve.vercel.app)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![PWA](https://img.shields.io/badge/PWA-対応-purple)

---

## 作った背景

SNS投稿用の動画を撮影する際、スクリプトを読みながら撮りたかったが、既存のテレプロンプターアプリは全文をスクロール表示するものが多く、**「2〜3文ごとに区切って、それぞれ個別に撮影する」**ワークフローに対応したツールがなかった。

そこで「スクリプトをショットに分割し、1ショットずつ録画・保存できる」PWAを自作した。iPhone のホーム画面に追加してネイティブアプリのように使える。

---

## デモ

**[https://teleprompter-mauve.vercel.app](https://teleprompter-mauve.vercel.app)**

iPhoneのSafariで「ホーム画面に追加」するとPWAとして動作します。

---

## 機能

- **スクリプト管理** — タイトルと本文を入力し、区切り単位（句点・感嘆符・英語ピリオド・改行）を選んで自動でショットに分割
- **ショット編集** — タップでテキストを編集、長押しで別のショットに重ねると合体。削除・合体はトーストの「元に戻す」で取り消せる。変更はその場で保存
- **撮影はネイティブアプリで** — 「🔴 撮影開始」で、残りのショットを Cinematic 撮影用のコンパニオンアプリ [teleprompter-cam](https://github.com/yujioyama/teleprompter-cam) に渡す。ブラウザ内での録画はしない
- **動画のインポート** — 「📁 動画をインポート」でファイルアプリから撮影済みの動画を複数まとめて選択し、ファイル名に含まれるショット ID で各ショットに自動で割り当てる
- **ショットジャンプ・ショット別設定** — カウンターをタップしてショット一覧から任意のショットへ移動。自動トリミングの余白はショットごとに上書きできる
- **動画を仕上げる**（「仕上げる」画面） — トリミング → 結合 → 字幕 → BGM → 書き出しのウィザードで、1 本の動画に仕上げる（下記「撮影後の仕上げ手順」参照）
- **途中から再開** — 手動トリム・結合結果・字幕の作業内容は端末内に保存され、画面を離れても iPhone がメモリ不足でページを再読み込みしても続きから再開できる
- **設定** — 音量の自動調整、字幕の位置、自動トリミングの余白、いつもの BGM とその音量
- **PWA** — ホーム画面に追加するとネイティブアプリのように全画面で起動。撮影した動画はブラウザに消されないよう永続ストレージを要求する

---

## 撮影後の仕上げ手順（トリミング・字幕・BGM）

全ショットを撮り終えたら、撮影画面の「🎬 動画を仕上げる」（またはホーム画面のスクリプトの 🎬）から仕上げ画面（`/scripts/:id/finalize`）に進みます。

1. **トリミング**
   各ショットの音声から発話区間を検出し、前後の無音をあらかじめカットした状態で開きます。ショットはセレクトと ‹ › ボタンで切り替え、プレイヤーは 1 つだけです（iPhone のデコーダー数の上限対策）。ハンドルで範囲を調整でき、「自動カットに戻す」で検出結果に戻せます。トリムが落ち着くと、各ショットのエンコードをバックグラウンドで先に進めます。
2. **結合する**
   トリム済みのショットを 1 本に結合します。処理が止まったときは「中断する」で止めて、同じトリムのままやり直せます。
3. **字幕**
   英語字幕は「台本から」（ショットのテキストをそのまま使う）か、「話した音声から」（Whisper で文字起こし。初回のみ約 80MB のモデルをダウンロード）のどちらかで作ります。アドリブや言い直しがある動画は「話した音声から」が向いています。
   - 「📋 Claude用プロンプトをコピー」で翻訳用のプロンプトをコピーし、Claude の返信を貼り付けて「日本語を反映」すると日本語字幕が入ります。
   - プレビューを見ながら字幕の位置（上部・中央・下部、または細かく調整）を決め、「次へ」で字幕を動画に焼き込みます。
4. **BGM**
   設定で「いつもの BGM」を選んでおくと、焼き込み後に自動で合成します。4 ジャンル（Lo-fi / ポップ / シネマチック / コーポレート）各 5 曲から選び直したり、音量を変えたり、BGM なしで進んだりもできます。
5. **書き出し**
   音量を Instagram / TikTok で再生されるレベルに自動で揃えたうえで（設定でオフにできます）、「保存する」で共有シートから保存します。ここで「BGMを外す」こともできます。

処理はすべてブラウザ内で行い、サーバーへのアップロードは発生しません。エンコード・結合・焼き込みは対応端末では WebCodecs（ハードウェアエンコード）を使い、使えない場合は ffmpeg.wasm にフォールバックします。

---

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フレームワーク | React 18 + TypeScript + Vite |
| ルーティング | react-router-dom v6 |
| ドラッグ&ドロップ | @dnd-kit |
| 動画処理 | WebCodecs + Mediabunny（ハードウェアエンコード）、@ffmpeg/ffmpeg (WASM) をフォールバックに |
| 音声解析 | Web Audio API |
| 音声認識 | Whisper（@huggingface/transformers、Web Worker で実行） |
| 撮影 | ネイティブアプリ [teleprompter-cam](https://github.com/yujioyama/teleprompter-cam) |
| ファイル共有 | Web Share API |
| ストレージ | localStorage（スクリプト・設定）、IndexedDB（動画・解析結果・仕上げの進捗） |
| テスト | Vitest + Testing Library |
| PWA | Service Worker + Web App Manifest |
| ホスティング | Vercel |

---

## 技術的課題

開発の途中で直面した課題と、その時点での解決策です（当時の実装を含みます）。

### 1. Service Worker によるキャッシュ問題（デプロイ後に画面真っ暗）

**症状：** 新しいコードをデプロイするたびに、アプリが真っ暗になる。

**根本原因：**
Service Worker が `index.html` をキャッシュしていた。新しいデプロイでJSバンドルのハッシュが変わっても、古い `index.html` がキャッシュから返り続け、存在しないJSファイルを参照して画面が真っ暗になる。

**解決策：**
`skipWaiting()` と `clients.claim()` でSWを即座に更新し、旧キャッシュを削除する。

```js
self.addEventListener('install', event => { self.skipWaiting() })
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})
```

---

### 2. MediaRecorder の fMP4 が動画編集アプリで再生できない

**症状：** iPhoneで録画した動画をCapCutに取り込むと、最初の一瞬だけ再生されて止まる。カメラロールでは問題なく再生できる。

**根本原因：**
ブラウザの `MediaRecorder` はフラグメントMP4（fMP4）を生成する。この形式では `moov` アトム（動画構造情報）がファイル末尾に置かれるが、CapCutなどの編集アプリは `moov` がファイル先頭にあることを期待する。

**解決に向けた試み：**

1. フレームレート固定 / データ収集方法変更 → 変化なし
2. ffmpeg.wasm（CDN の UMD ビルド）で変換 → `failed to import ffmpeg-core.js` エラー
3. ffmpeg-core.js を自サーバーから配信（CORS 対策）→ 同じエラー継続
4. **ESM ビルド（`dist/esm/`）に切り替え → 解決** ✅

**原因の特定：** iOS Safari の ES モジュール Worker 内で `import()` を使って動的に JS を読み込む際、UMD 形式のファイルは互換性がない。ESM ビルドに切り替えることで解決した。

```json
"postinstall": "mkdir -p public/ffmpeg && cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js public/ffmpeg/ && cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm public/ffmpeg/"
```

録画停止後、自動で `-movflags +faststart`（moov を先頭に移動）変換を行い、編集アプリとの互換性を確保している。

---

### 3. iOS PWA ホーム画面追加後の更新

**状況：** ホーム画面に追加した PWA は URL バーやメニューが表示されないため、ハードリロードができない。

**解決策：** SW 自動更新により、アプリスイッチャーで完全終了 → 再起動するだけで最新版が適用される。

---

### 4. localStorage の競合状態

**症状：** 新規スクリプト作成後に「スクリプトが見つかりません」エラー。

**根本原因：** `useEffect` で localStorage に保存していたため、`navigate()` でページ遷移後（コンポーネントアンマウント後）に保存が実行されるタイミング問題。

**解決策：** `setScripts` の updater 関数内で同期的に保存する。

```ts
setScripts(prev => {
  const updated = [...prev, script]
  saveToStorage(updated)  // navigate() の前に確実に保存
  return updated
})
```

---

### 5. iOS Share Sheet キャンセル時の誤遷移

**症状：** カメラロールへの保存で共有シートを「キャンセル」すると、保存されていないのに次のショットに進んでしまう。

**根本原因：**
Web Share API はキャンセル時に `AbortError` をスローするが、これを `Promise<void>` として扱っていたため、成功・キャンセルを区別できていなかった。

**解決策：**
`shareOrDownload()` の戻り値を `Promise<boolean>` に変更し、`AbortError` のときのみ `false` を返す。呼び出し側で `false` の場合は遷移をブロックする。

```ts
async function shareOrDownload(filename: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: filename })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
    // AbortError 以外は download fallback へ
  }
}

async function handleSaveAndNext() {
  const saved = await shareOrDownload(getFilename())
  if (!saved) return  // キャンセル — 現在のショットに留まる
  setShotIndex(i => i + 1)
}
```

---

### 6. Web Audio API による RMS ベースの無音検出

**要件：** 発話前後の無音を自動でカットして、編集工数を減らしたい。

**実装：**
録画後の MP4 を `AudioContext.decodeAudioData()` でデコードし、50ms 窓で RMS（二乗平均平方根）を計算。閾値（-36 dBFS）を超えた最初と最後の窓を発話区間とし、その前後にパディングを加えてトリム範囲を決定する。

```ts
function rms(offset: number): number {
  const end = Math.min(offset + windowSize, mono.length)
  let sum = 0
  for (let i = offset; i < end; i++) sum += mono[i] * mono[i]
  return Math.sqrt(sum / (end - offset))
}
```

発話開始前（デフォルト 0.5s）と終了後（デフォルト 0.8s）で**非対称のパディング**を設定できるようにした。話し終わりの音声が切れるという問題に対して、終了後を長めにとることで対応している。

---

### 7. FFmpeg `-c copy` のキーフレーム境界問題（映像が途中で止まる）

**症状：** トリミング後の動画で、末尾付近の映像が止まるのに音声は最後まで再生される。

**根本原因：**
FFmpeg のストリームコピー（`-c copy`）はキーフレーム単位でしか映像をカットできない。iOS の MediaRecorder はキーフレームを約1秒おきに挿入するため、`trim.end` がキーフレームの間に落ちると、映像は直前のキーフレームで終了するが、音声は正確な時刻まで続く。

**解決策：**
FFmpeg に渡す終了時刻に **1.5s のバッファを加算**することで、最後のキーフレームが確実に出力に含まれるようにした。ストリームコピーのままなので速度は維持される。

```ts
const KEY_FRAME_BUFFER = 1.5
const duration = (trim.end + KEY_FRAME_BUFFER) - (trim.start > 0.05 ? trim.start : 0)
args.push('-t', duration.toFixed(3))
args.push('-c', 'copy', '-movflags', '+faststart', 'out.mp4')
```

---

## ローカル開発

```bash
git clone https://github.com/yujioyama/teleprompter.git
cd teleprompter
npm install   # postinstall で ffmpeg コアファイルが public/ffmpeg にコピーされる
npm run dev
```

## テスト

```bash
npm run test
```

## デプロイ

Vercel に自動デプロイ。`main` ブランチへの push で更新。

- Build Command: `npm run build`
- Output Directory: `dist`

---
---

# Teleprompter App (English)

**A shot-based teleprompter PWA built for recording SNS videos — record one short segment at a time.**

[![Demo](https://img.shields.io/badge/Demo-teleprompter--mauve.vercel.app-blue)](https://teleprompter-mauve.vercel.app)

---

## Why I Built This

When recording videos for social media, I wanted to read from a script — but most teleprompter apps show the entire script at once. I needed something that would let me **split a script into 2–3 sentence segments and record each one individually**, then move on.

So I built a PWA that runs directly in iPhone Safari, can be added to the home screen, and handles the full workflow: write script → split into shots → record each shot (in the companion app) → trim, subtitle, add BGM and export one finished video.

---

## Demo

**[https://teleprompter-mauve.vercel.app](https://teleprompter-mauve.vercel.app)**

Add to iPhone home screen via Safari for the full PWA experience.

---

## Features

- **Script management** — Enter a script and auto-split it into shots by delimiter (Japanese period, exclamation/question marks, English period, newline)
- **Shot editing** — Tap to edit a shot; long-press and drop it onto another to merge them. Deleting or merging can be undone from a toast. Every change is saved as it's made
- **Recording in a native app** — "🔴 撮影開始" hands the remaining shots to the Cinematic-capture companion app [teleprompter-cam](https://github.com/yujioyama/teleprompter-cam). The PWA doesn't record in the browser
- **Import** — Pick several takes at once from the Files app; each is matched to its shot by the shot ID in its filename
- **Shot jump & per-shot settings** — Tap the counter to jump to any shot; auto-trim padding can be overridden per shot
- **Finalize** — A trim → combine → subtitles → BGM → export wizard that produces one finished video (see below)
- **Pick up where you left off** — Hand-set trims, the combined video and subtitle work are stored on the device, so leaving the page, or iOS reloading it for memory, doesn't lose them
- **Settings** — Loudness normalization, subtitle position, auto-trim padding, the usual BGM and its volume
- **PWA** — Installable to the home screen, runs fullscreen, and requests persistent storage so stored takes aren't evicted

---

## Finalizing a Video

1. **Trim** — Each shot opens already cut to its detected speech. One player for all shots (iOS limits live video decoders); shots are picked from a select or with ‹ ›. Shots start encoding in the background once the trims settle.
2. **Combine** — Joins the trimmed shots into one video. A stuck combine can be cancelled and retried with the same trims.
3. **Subtitles** — English cues come from the script, or from what was actually said, transcribed by Whisper in the browser (a ~80MB model downloaded once). Copy a prompt for Claude, paste its Japanese translation back, pick a position, and burn the subtitles in.
4. **BGM** — The usual BGM (set in Settings) is mixed in automatically; otherwise pick from 20 tracks in 4 genres, adjust the volume, or skip.
5. **Export** — Loudness is brought to the level Instagram/TikTok play at, the BGM can still be removed, and the video is saved through the share sheet.

Everything runs in the browser — nothing is uploaded. Encoding, joining and burning use WebCodecs (hardware encoding) where available, falling back to ffmpeg.wasm.

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Routing | react-router-dom v6 |
| Drag & Drop | @dnd-kit |
| Video Processing | WebCodecs + Mediabunny (hardware encoding), @ffmpeg/ffmpeg (WASM) as fallback |
| Audio Analysis | Web Audio API |
| Speech Recognition | Whisper (@huggingface/transformers, in a Web Worker) |
| Recording | Native companion app [teleprompter-cam](https://github.com/yujioyama/teleprompter-cam) |
| File Sharing | Web Share API |
| Storage | localStorage (scripts, settings), IndexedDB (takes, analyses, finalize progress) |
| Testing | Vitest + Testing Library |
| PWA | Service Worker + Web App Manifest |
| Hosting | Vercel |

---

## Technical Challenges

Problems hit along the way and how they were solved at the time (some describe earlier implementations).

### 1. Service Worker Cache Invalidation (Blank Screen After Deploy)

**Symptom:** After every new deploy, the app would show a completely blank screen.

**Root cause:** The Service Worker was caching `index.html`. After a new deploy, JS bundle filenames change (content hash), but the cached `index.html` kept referencing the old — now nonexistent — filenames.

**Fix:** Use `skipWaiting()` + `clients.claim()` to force immediate SW activation and delete stale caches on every deploy.

---

### 2. MediaRecorder fMP4 Incompatibility with Video Editors

**Symptom:** Videos recorded on iPhone played fine in the camera roll but froze immediately when imported into CapCut.

**Root cause:** `MediaRecorder` produces fragmented MP4 (fMP4), which places the `moov` atom at the end of the file. Video editing apps expect `moov` at the beginning.

**Debugging journey:**
1. Fixed frame rate / changed data collection → no change
2. ffmpeg.wasm (CDN UMD build) → `failed to import ffmpeg-core.js`
3. Self-hosted ffmpeg-core.js → same error
4. **Switched to ESM build (`dist/esm/`) → fixed ✅**

**Root cause identified:** iOS Safari's ES module Workers use dynamic `import()`, which is incompatible with UMD-format files. Switching to the ESM build resolved it. After every recording, the app runs an automatic `-movflags +faststart` remux to move the `moov` atom to the front.

---

### 3. PWA Updates on iOS Home Screen

**Situation:** PWAs installed to the home screen have no URL bar or browser menu — there's no way to hard reload.

**Fix:** The SW auto-updates on install. Users just need to fully close and reopen the app from the app switcher.

---

### 4. localStorage Race Condition

**Symptom:** After creating a new script, the app showed "Script not found."

**Root cause:** Saving to localStorage was triggered in `useEffect`, which runs after render — sometimes after `navigate()` had already unmounted the component.

**Fix:** Save synchronously inside the `setScripts` updater function, before `navigate()` is called.

---

### 5. iOS Share Sheet Cancel Causing Unintended Navigation

**Symptom:** Cancelling the share sheet (without saving to camera roll) would still advance to the next shot, losing the recording.

**Root cause:** Web Share API throws `AbortError` on cancel, but the return type was `Promise<void>` — success and cancel were indistinguishable.

**Fix:** Changed `shareOrDownload()` to return `Promise<boolean>`. Returns `false` only on `AbortError`; the caller blocks navigation when `false`.

```ts
async function shareOrDownload(filename: string): Promise<boolean> {
  try {
    await navigator.share({ files: [file], title: filename })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
  }
}
```

---

### 6. RMS-Based Silence Detection with Web Audio API

**Requirement:** Automatically trim silence before and after speech to reduce manual editing.

**Implementation:** After recording, the MP4 blob is decoded with `AudioContext.decodeAudioData()`. RMS (root mean square) energy is computed in 50ms windows. The first and last windows exceeding a -36 dBFS threshold define the speech region. Padding is added on both sides before passing trim bounds to FFmpeg.

Padding is **asymmetric**: 0.5s before speech, 0.8s after. This accounts for speech endings being detected too early due to natural trailing off.

---

### 7. FFmpeg Stream Copy Keyframe Boundary Bug (Video Freezes at End)

**Symptom:** After trimming, the video would freeze near the end while audio continued playing normally.

**Root cause:** FFmpeg's stream copy (`-c copy`) can only cut video at keyframe boundaries. iOS MediaRecorder inserts keyframes roughly every 1 second. When `trim.end` falls between keyframes, the video ends at the last keyframe *before* `trim.end`, but audio ends at the exact timestamp — causing a visible freeze.

**Fix:** Add a 1.5s buffer to `trim.end` when passing it to FFmpeg. This ensures the next keyframe after the speech endpoint is always included. Stream copy is preserved, so performance is unchanged.

```ts
const KEY_FRAME_BUFFER = 1.5
const duration = (trim.end + KEY_FRAME_BUFFER) - (trim.start > 0.05 ? trim.start : 0)
args.push('-t', duration.toFixed(3))
args.push('-c', 'copy', '-movflags', '+faststart', 'out.mp4')
```

---

## Local Development

```bash
git clone https://github.com/yujioyama/teleprompter.git
cd teleprompter
npm install   # postinstall copies ffmpeg core files to public/ffmpeg
npm run dev
```

## Testing

```bash
npm run test
```

## Deployment

Auto-deployed to Vercel on push to `main`.

- Build Command: `npm run build`
- Output Directory: `dist`
