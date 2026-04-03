# Teleprompter App

iPhoneのホーム画面に追加して使えるテレプロンプター＋ショット録画PWAです。

## 機能

- **スクリプト管理** — タイトルと本文を入力し、自動分割でショットに分ける
- **ショット編集** — ドラッグ＆ドロップで並び替え、テキスト編集
- **録画** — ショットごとにテレプロンプターを見ながら録画
- **録画レビュー** — 停止後に即座に再生確認。やり直しも可能
- **カメラロール保存** — 「次へ」を押すと自動でカメラロールに保存
- **外部マイク対応** — USB-Cマイク接続後に「マイク再接続」ボタンで切り替え可能

## 技術スタック

- React + TypeScript + Vite
- react-router-dom
- @dnd-kit（ドラッグ＆ドロップ）
- @ffmpeg/ffmpeg（録画後のMP4変換）
- PWA（Service Worker、manifest.json）
- Vercel（ホスティング）

---

## 開発中に直面した技術的課題

### 1. Service Workerによるキャッシュ問題（デプロイ後に画面真っ暗）

**症状：** 新しいコードをデプロイするたびに、アプリが真っ暗になる。

**根本原因：**
Service Workerが `index.html` をキャッシュしていた。新しいデプロイでJSバンドルのハッシュが変わっても、古い `index.html` がキャッシュから返り続け、存在しないJSファイルを参照して画面が真っ暗になる。

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

### 2. MediaRecorderのフラグメントMP4がCapCutで再生できない

**症状：** iPhoneで録画した動画をCapCutに取り込むと、最初の一瞬だけ再生されて止まる。カメラロールでは問題なく再生できる。

**根本原因：**
ブラウザの `MediaRecorder` はフラグメントMP4（fMP4）を生成する。この形式では `moov` アトム（動画構造情報）がファイル末尾に置かれるが、CapCutなどの編集アプリは `moov` がファイル先頭にあることを期待する。

**解決に向けた試み：**

1. フレームレート固定 / データ収集方法変更 → 変化なし
2. ffmpeg.wasm（CDNのUMDビルド）で変換 → `failed to import ffmpeg-core.js` エラー
3. ffmpeg-core.jsを自サーバーから配信（CORS対策）→ 同じエラー継続
4. **ESMビルド（`dist/esm/`）に切り替え → 解決** ✅

**原因の特定：** iOS SafariのESモジュールWorker内で `import()` を使って動的にJSを読み込む際、UMD形式のファイルは互換性がない。ESMビルドに切り替えることで解決した。

```json
"postinstall": "mkdir -p public/ffmpeg && cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js public/ffmpeg/ && cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm public/ffmpeg/"
```

録画停止後、自動で `-movflags +faststart`（moovを先頭に移動）変換を行い、CapCutなど編集アプリとの互換性を確保している。

---

### 3. iOS PWAホーム画面追加後の更新

**状況：** ホーム画面に追加したPWAはURLバーやメニューが表示されないため、ハードリロードができない。

**解決策：** SW自動更新により、アプリスイッチャーで完全終了→再起動するだけで最新版が適用される。

---

### 4. localStorageの競合状態

**症状：** 新規スクリプト作成後に「スクリプトが見つかりません」エラー。

**根本原因：** `useEffect` でlocalStorageに保存していたため、`navigate()` でページ遷移後（コンポーネントアンマウント後）に保存が実行されるタイミング問題。

**解決策：** `setScripts` のupdater関数内で同期的に保存する。

```ts
setScripts(prev => {
  const updated = [...prev, script]
  saveToStorage(updated)  // navigate() の前に確実に保存
  return updated
})
```

---

## ローカル開発

```bash
cd teleprompter-app
npm install   # postinstallでffmpegコアファイルがpublic/ffmpegにコピーされる
npm run dev
```

## デプロイ

Vercelに自動デプロイ。`main` ブランチへのpushで更新。

- Root Directory: `teleprompter-app`
- Build Command: `npm run build`
- Output Directory: `dist`
