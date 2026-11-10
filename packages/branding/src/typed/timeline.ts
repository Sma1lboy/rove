// Frame timeline of the typed film: an intro, eight chapters (a colour card, then a
// demo), and the end card. Every beat in TypedFilm.tsx is placed with `at(chapter, t)`.

export const FPS = 60

export const INTRO = 300
/** A chapter's colour card: wipes in, holds, wipes out. The stage cuts under it. */
export const CARD = 54
export const WIPE = 12
/** Demo length per chapter, in frames. */
export const DEMO = [170, 170, 240, 200, 190, 130, 170, 170] as const
export const FINALE = 270

export const CHAPTERS = DEMO.length

/** First frame of chapter i's card. */
export const cardStart = (i: number) => {
  let f = INTRO
  for (let j = 0; j < i; j++) f += CARD + DEMO[j]
  return f
}

/** Frame the stage switches to chapter i, hidden under its card. */
export const cutAt = (i: number) => cardStart(i) + WIPE

/** Absolute frame of chapter i's demo-local frame t. */
export const at = (i: number, t: number) => cardStart(i) + CARD + t

export const FINALE_START = cardStart(CHAPTERS)

export const TYPED = { width: 1920, height: 1080, fps: FPS, durationInFrames: FINALE_START + FINALE } as const

/** The chapter on stage at this frame, or -1 during the intro. */
export const chapterAt = (frame: number) => {
  let ch = -1
  for (let i = 0; i < CHAPTERS; i++) if (frame >= cutAt(i)) ch = i
  return ch
}
