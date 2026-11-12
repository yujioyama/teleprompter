import { detectSpeech } from './detectSpeechBounds'
import { updateShotAnalysis } from './shotAnalysisStore'

/**
 * Find where the speech is in a take just saved, and keep it where the
 * finalize step looks for it: that step then opens with every shot already
 * cut, instead of holding 結合 while it decodes each one.
 *
 * Never rejects: a take that can't be analysed here is analysed there, as
 * before.
 */
export async function analyzeTake(scriptId: string, shotId: string, videoUpdatedAt: string, blob: Blob): Promise<void> {
  try {
    const speech = await detectSpeech(blob)
    await updateShotAnalysis(scriptId, shotId, videoUpdatedAt, { speech })
  } catch (err) {
    console.warn('[analyzeTake] could not find the speech ahead of the finalize step:', err)
  }
}
