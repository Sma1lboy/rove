// Frame timeline shared by the sheet (RoveLife.tsx) and its score
// (scripts/life-score.ts): the music lands on these frames, so both read them here.

export const LIFE = { width: 1920, height: 1080, fps: 30, durationInFrames: 1230 } as const

export const INTRO = 50
/** One milestone. The score treats it as one 4/4 bar. */
export const BEAT = 84
/** How long a part's strokes take to ink, within its beat. */
export const DRAW = 56
/** The revision where the title block's KOBE is struck and re-lettered ROVE. */
export const RENAME_PART = 8

export const partStart = (i: number) => INTRO + i * BEAT

/** Frame the new name starts being lettered in the title block. */
export const RELETTER = partStart(RENAME_PART) + DRAW * 0.6
