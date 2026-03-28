# Trim Settings Design

**Date:** 2026-03-28

## Context

The app currently auto-trims silence from recorded video with a hardcoded 0.5s padding before/after speech. Users want to:
1. Control the padding duration globally
2. Toggle auto-trimming on/off globally
3. Override both settings per-shot (persisted on the Shot object)

---

## Architecture

### Approach: Global settings hook + per-shot override fields

Global settings stored in localStorage. Shot object holds optional override values; `undefined` means "use global setting".

---

## Data Model

### `types.ts` — Shot additions
```ts
interface Shot {
  // ...existing fields...
  trimEnabled?: boolean  // undefined = use global setting
  trimPadding?: number   // undefined = use global setting
}
```

### `useSettings` hook (new)
- File: `src/hooks/useSettings.ts`
- localStorage key: `'teleprompter_settings'`
- Shape:
```ts
interface AppSettings {
  trimEnabled: boolean
  trimPadding: number  // seconds
}
```
- Defaults: `{ trimEnabled: true, trimPadding: 0.5 }`
- Returns `[settings, updateSettings]` where `updateSettings: (patch: Partial<AppSettings>) => void`
- On localStorage parse failure, silently fall back to defaults

---

## Settings Page

- New files: `src/pages/SettingsPage.tsx` + `src/pages/SettingsPage.module.css`
- Route: `/settings` added to `App.tsx`
- Navigation: gear icon button on `HomePage`
- Controls:
  - Auto-trim toggle (on/off)
  - Padding duration slider: **0.2s – 2.0s**, step 0.1s
    - Minimum is 0.2s (not 0.1s) to stay above the internal skip-trim threshold in `detectSpeechBounds` (see Trimming Logic section)

---

## RecordPage Per-Shot Override

### Persistence
`RecordPage` will call `useScripts`'s `updateScript` to persist per-shot override changes. `updateScript` accepts `Partial<Pick<Script, 'title' | 'shots'>>`, so updating a single shot requires reading the current shots array, spreading the modified shot, and passing the full updated array: `updateScript(scriptId, { shots: shots.map(s => s.id === shotId ? { ...s, trimEnabled, trimPadding } : s) })`.

### UI
- Collapsible settings area: "⚙ このショットの設定" button
- Collapsed by default
- When expanded:
  - "グローバル設定を使用" toggle (default ON = no override)
  - When toggled OFF: show trimEnabled toggle + trimPadding slider for this shot
  - Changes written immediately to Shot via `updateScript`
- Effective value logic: `shot.trimEnabled ?? settings.trimEnabled`

### Out of scope
Per-shot trim settings are only editable from `RecordPage`. `ShotEditPage` does not expose these fields.

---

## Trimming Logic Changes

### `src/utils/detectSpeechBounds.ts`
- Remove hardcoded `PADDING_S = 0.5`
- Add `padding: number` parameter to function signature
- The internal skip-trim guard (`if savedStart < 0.1 && savedEnd < 0.1 return null`) remains hardcoded. This guard fires when the speech starts very close to the beginning of the clip (`start < 0.1s`), not based on the padding value — so it can trigger regardless of the user's padding setting when there is very little silence to trim at both the start and end of the clip. The safe outcome is `null` (no trim applied), which is acceptable.

### `src/hooks/useRecorder.ts`
- Add `shotSettings: { trimEnabled: boolean, trimPadding: number }` parameter to `startRecording(stream, shotSettings)` rather than to the hook itself. `RecordPage` calls `useRecorder()` once at mount and calls `startRecording` for each shot — passing settings at call time avoids stale-closure issues as `shotIndex` advances.
- Update `UseRecorderResult` interface: `startRecording` signature changes from `(stream: MediaStream) => void` to `(stream: MediaStream, shotSettings: { trimEnabled: boolean, trimPadding: number }) => void`
- The `onstop` handler is defined as a closure inside `startRecording`, so it directly closes over the `shotSettings` parameter — no ref is needed.
- On recording stop (MP4 path):
  - If `trimEnabled === false`: skip `detectSpeechBounds`, pass no trim to `remuxMp4`
  - If `trimEnabled === true`: call `detectSpeechBounds(raw, trimPadding)`
- **webm path**: trimming is not supported on webm recordings (desktop Chrome). The `trimEnabled` setting is silently ignored on this path — behavior is unchanged from today.

### `src/pages/RecordPage.tsx`
- Read global settings via `useSettings()`
- Compute effective settings per shot: `{ trimEnabled: shot.trimEnabled ?? settings.trimEnabled, trimPadding: shot.trimPadding ?? settings.trimPadding }`
- Pass effective settings to `startRecording(stream, effectiveSettings)` at recording start time
- The per-shot settings UI panel (collapsed by default) resets to collapsed state on each retry (`handleRetry`) — override values are preserved in localStorage but the panel UI does not remain open

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/hooks/useSettings.ts` |
| Create | `src/pages/SettingsPage.tsx` |
| Create | `src/pages/SettingsPage.module.css` |
| Modify | `src/types.ts` |
| Modify | `src/App.tsx` |
| Modify | `src/pages/HomePage.tsx` |
| Modify | `src/pages/RecordPage.tsx` |
| Modify | `src/hooks/useRecorder.ts` |
| Modify | `src/utils/detectSpeechBounds.ts` |

---

## Verification

1. `npm run build` passes with no TypeScript errors
2. Settings page is accessible from the home screen via gear icon
3. **Trim off (iOS Safari / MP4):** Toggle trim off globally → record a shot on iPhone → confirm the output video retains full audio including silence
4. **Custom padding (iOS Safari / MP4):** Set global padding to 1.0s → record a shot → confirm ~1s of silence is kept before/after speech
5. **Per-shot override:** Set a per-shot override (different trimPadding) on one shot → record → confirm that shot uses the override value while other shots still use global settings
6. **Override persists across retakes:** After setting a per-shot override, press "もう一度" (retry) and re-record → navigate away and back → open the shot's settings area and confirm `trimEnabled`/`trimPadding` override fields are still set on the Shot object (inside the `teleprompter_scripts` key in localStorage, not `teleprompter_settings`)
7. **webm path unchanged:** On desktop Chrome, trim setting has no visible effect — video is returned as-is regardless of `trimEnabled` value
