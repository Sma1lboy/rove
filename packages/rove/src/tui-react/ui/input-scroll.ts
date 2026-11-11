/**
 * OpenTUI keeps the cursor of a single-line input a margin away from the right edge, so a value that
 * nearly fills its field scrolls and loses its first cells. Rove's inputs scroll only when the text overflows.
 */
export const INPUT_SCROLL = { scrollMargin: 0 } as const
