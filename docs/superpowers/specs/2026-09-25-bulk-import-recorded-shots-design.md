# ネイティブ撮影アプリからの一括インポート

## 背景・課題

撮影は現在、teleprompter-cam（別リポジトリのiOSネイティブアプリ）に一任している。`ShotEditPage`/`RecordPage`は`teleprompter-cam://record?shots=<json>`を叩いて撮影対象のショット一覧を渡すだけで、撮影後にネイティブアプリからPWAへ戻ってくる際のハンドリングが一切ない。

teleprompter-cam側は各ショットの録画をPhotos（カメラロール）に保存しており、その際のファイル名にショットIDを埋め込んでいる（`ShotSession.swift`）:

```
TeleprompterCam-<sessionTag>-shot<paddedIndex>of<count>-<shot.id>.mov
```

コメントに「so the saved Photos asset can be identified later (e.g. which shot it belongs to when importing into the web app)」とある通り、Web側でファイル名からショットを自動判別してまとめて取り込む設計が意図されていたが、PWA側は1本ずつ手動インポート（`RecordPage`の「🖼 カメラロールからインポート」で毎回`currentShot`に紐付け）しか実装されていない。

そのため、複数ショットをteleprompter-camでまとめて撮影して戻ってきても、PWA側は何も変化せず、「仕上げるボタンがどこにも無い」という体験になっていた。

## ゴール

teleprompter-camから戻った後、Photosから撮影した動画をまとめて選択するだけで、ファイル名に埋め込まれたショットIDを使って自動的に各ショットへ紐付け・保存し、全ショット分揃っていれば自動で撮影完了画面（🎬 仕上げるボタン付き）まで進める。

## 非ゴール

- teleprompter-cam側（Swift）の変更は行わない（ファイル名の埋め込みは既存のまま利用する）
- iOSの技術的制約上、ネイティブアプリからの完全自動コールバック（ユーザー操作なしでのファイル受け渡し）は対象外。ユーザーが一度Photosピッカーでファイルを選ぶ操作は残る
- 複数スクリプトをまたいだ一括インポートは対象外（現在開いているスクリプトのショットのみに対してマッチングする）

## アーキテクチャ

### 新規ユーティリティ: `src/utils/matchShotRecordings.ts`

ファイル名からショットIDを抽出し、渡された`Shot[]`とマッチングする純粋関数群。

```ts
export function extractShotId(filename: string): string | null
// "TeleprompterCam-abc-shot01of05-<uuid>.mov" -> "<uuid>"
// マッチしなければ null

export type ImportResolution =
  | { kind: 'legacy'; file: File }               // 1本だけ選択され、どのショットにも一致しなかった
  | { kind: 'bulk'; targets: { shot: Shot; file: File }[] } // 1本以上が既知のショットIDに一致
  | { kind: 'error'; unmatchedFilenames: string[] }         // 複数選択のうち1本でも不一致

export function resolveImportTargets(
  files: File[],
  shots: Shot[],
): ImportResolution
```

判定ルール:
1. `files.length === 1` かつ抽出したIDがこのスクリプトの`shots`に存在しない → `legacy`（今まで通りcurrentShotへの手動インポート扱い）
2. それ以外で、全ファイルが`shots`内のいずれかのIDに一致 → `bulk`
3. それ以外（2本以上選択、かつ1本でも不一致）→ `error`

同じショットIDに複数ファイルが一致した場合は、配列内の最後のファイルを採用する（上書き、警告なし）。

### ロジック抽出: `src/utils/processRecordedVideo.ts`

現在`useRecorder.ts`の`processFinishedBlob`に閉じ込められているtrim検出＋remuxの処理を、状態管理を持たない純粋な非同期関数として切り出す。

```ts
export interface ProcessedVideo {
  blob: Blob
  ok: boolean
  error: string | null
}

export async function processRecordedVideo(
  raw: Blob,
  mimeType: string,
  shotSettings: ShotTrimSettings,
): Promise<ProcessedVideo>
```

`useRecorder.ts`の`processFinishedBlob`はこの関数を呼び出すように書き換え、既存の`state`遷移（`remuxing` → `stopped`）や`blobRef`更新はフック側に残す。振る舞いは変更しない。

新しい一括インポートのコードパスは、フックを経由せずこの関数を直接呼び、結果を`saveShotVideo`で保存する（レビューUIなし）。

### `RecordPage.tsx`の変更

- `<input type="file">`に`multiple`属性を追加
- `handleImportFromCameraRoll`を拡張:
  ```
  const files = Array.from(e.target.files ?? [])
  const resolution = resolveImportTargets(files, safeScript.shots)

  switch (resolution.kind) {
    case 'legacy':
      importFile(resolution.file, effectiveSettingsForCurrentShot) // 既存動作そのまま
      break
    case 'error':
      setImportError(`一致しないファイルがあります: ${resolution.unmatchedFilenames.join(', ')}`)
      break
    case 'bulk':
      await runBulkImport(resolution.targets)
      break
  }
  ```
- `runBulkImport`: ショットごとに順番に処理する（並列にはしない — ffmpeg wasmのメモリ負荷を避けるため）
  - 各ショットの実効trim設定（ショット個別のオーバーライド ?? グローバル設定）を使って`processRecordedVideo`を呼ぶ
  - 成功したら`saveShotVideo(script.id, shot.id, processed.blob)`（既存動画があれば確認なしで上書き）
  - 失敗したショットIDを集めておく
  - 進捗状態 `{ done, total }` をUIに表示（「インポート中 (2/4)...」）
  - 全件処理後、`listShotVideos(script.id)`を再取得し、動画がまだ無い最初のショットへ`shotIndex`を移動。全ショットに動画があれば`shotIndex = shots.length`にする（`isComplete`画面へ）
  - 失敗があれば「◯件中◯件を保存できませんでした（失敗: ...）」のサマリーを表示

## データフロー（詳細）

1. `ShotEditPage`または`RecordPage`から`teleprompter-cam://record?shots=...`を起動 → teleprompter-camで撮影 → Photosに保存 → ユーザーがPWAのタブに戻る（既存の`RecordPage`のidle画面、shotIndexは起動時のまま）
2. 「🖼 カメラロールからインポート」をタップ → Photosピッカー（`multiple`）で撮影した動画を好きな順・好きな本数選択
3. `resolveImportTargets`で判定 → 上記の`legacy`/`bulk`/`error`のいずれかに分岐
4. `bulk`の場合、順番に処理・保存し、進捗表示 → 完了後に`shotIndex`を自動で進める
5. 全ショット分の動画が揃っていれば、既存の`isComplete`分岐（`RecordPage.tsx:193-215`）がそのままレンダリングされ、「🎬 動画を仕上げる」ボタンが表示される

## エラー処理

| ケース | 挙動 |
|---|---|
| 複数ファイル選択で1本でも未マッチ | 何も保存せず、未マッチファイル名を列挙してエラー表示 |
| bulk処理中に特定の1本だけ`processRecordedVideo`が失敗 | そのショットはスキップし、残りは処理を継続。完了後にサマリーでどのショットが失敗したか表示 |
| 1本だけ選択・未マッチ（legacy） | 既存の`importFile`パス・エラー表示（`persistError`）をそのまま利用 |

## テスト方針

- `src/utils/matchShotRecordings.test.ts`（新規）
  - `extractShotId`: 正しい形式からのUUID抽出、拡張子違い、パターン非一致
  - `resolveImportTargets`: 1本＆マッチ→bulk、1本＆未マッチ→legacy、複数＆全マッチ→bulk、複数＆一部未マッチ→error、同一ショットIDへの複数ファイル（後勝ち）
- `src/utils/processRecordedVideo.test.ts`（`useRecorder.ts`から処理ロジックを切り出した後、既存のtrim/remux関連のテストケースをここに移設）
- `RecordPage`の結合テストは既存のテストカバレッジ状況を見て、bulk importの主要分岐（全マッチ→完了画面遷移、一部マッチ→次の未撮影ショットへ移動）だけ追加を検討

## 実装で確認・注意すべき点

- iOSのPhotosピッカー（`<input type="file" multiple accept="video/*">`）が、teleprompter-cam側で`PHAssetResourceCreationOptions.originalFilename`に設定したファイル名をそのまま`File.name`として返すかどうかは、実機での動作確認が必要（iOSバージョンやPhotosピッカーの実装により`IMG_XXXX.MOV`に丸められる可能性がある）。もし丸められてしまう場合はこの設計の前提が崩れるため、実装着手時に早めに実機検証する。
