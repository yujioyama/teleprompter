import { useEffect, useRef, useState } from 'react'
import type { Script } from '../types'
import { openingCardPlanOf, type OpeningCardPlan, type OpeningStyle } from '../utils/openingCard'
import { openingVoiceOf } from '../utils/webcodecs/openingVoice'

/**
 * The script's 冒頭カード as the burn and the audio take it, timed to its
 * recorded voice: null for none, undefined while the voice is being read.
 * A voice that can't be read leaves the card typed without one (and says
 * so in the console). `ready` resolves to the same, for a burn that can't
 * go before it's known. `style` is how it looks (the setting).
 */
export function useOpeningCard(script: Pick<Script, 'id' | 'opening'> | undefined, style: OpeningStyle): {
  plan: OpeningCardPlan | null | undefined
  ready: () => Promise<OpeningCardPlan | null>
} {
  const scriptId = script?.id
  const text = script?.opening?.text
  const ja = script?.opening?.ja
  const [plan, setPlan] = useState<OpeningCardPlan | null | undefined>(() => (text?.trim() ? undefined : null))
  const readyRef = useRef<Promise<OpeningCardPlan | null>>(Promise.resolve(null))

  useEffect(() => {
    const opening = text?.trim() ? { text, ...(ja ? { ja } : {}) } : undefined
    if (!scriptId || !opening) {
      setPlan(null)
      readyRef.current = Promise.resolve(null)
      return
    }
    let cancelled = false
    setPlan(undefined)
    const made = openingVoiceOf(scriptId)
      .catch(err => {
        console.warn('[useOpeningCard] could not read the opening voice, typing the card without it:', err)
        return null
      })
      .then(voice => openingCardPlanOf(opening, voice ? { key: voice.key, timing: voice.timing } : null, style))
    readyRef.current = made
    void made.then(next => {
      if (!cancelled) setPlan(next)
    })
    return () => {
      cancelled = true
    }
  }, [scriptId, text, ja, style])

  return { plan, ready: () => readyRef.current }
}
