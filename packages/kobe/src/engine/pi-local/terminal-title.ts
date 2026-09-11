/**
 * The pi family's OSC 0/2 title policy — the vendor-specific half of
 * `../terminal-title.ts`.
 *
 * Captured live on 2026-09-11 (raw PTY bytes, replayed through xterm):
 *
 *   omp 18.1.17 writes `π <separator> <label>`, where the separator is a
 *   braille spinner frame while a turn runs, `>` at rest, and `!` while the
 *   engine is blocked on a human (verified at a real `Allow tool` prompt) —
 *   `π: <label>` when `tui.titleState` is off. Before a session has a name
 *   the label is the cwd basename, so a fresh tab reads `π > work`.
 *
 *   pi 0.80.6 writes `π - <session name> - <cwd>` (the name segment is
 *   omitted until the session is named) and NOTHING else — no spinner, no
 *   run-state separator. Its title is a name, not a status surface, which is
 *   why its policy claims no `workingPrefixes` and says `ownsStatus: false`:
 *   Rove's own turn glyph is the only state indication such a title can have.
 */

/** omp's run-state separator glyphs, verbatim from its `title-generator`. */
const OMP_SPINNER_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** The brand every pi-family title starts with. */
const BRAND = "π"

/** `π <frame>` — the whole status token, so stripping leaves just the label. */
export const OMP_WORKING_PREFIXES: readonly string[] = OMP_SPINNER_FRAMES.map((frame) => `${BRAND} ${frame}`)

/** `π !` — the engine is blocked on a human (approval prompt, ask dialog). */
export const OMP_ATTENTION_PREFIXES: readonly string[] = [`${BRAND} !`]

/** Everything omp can put between the brand and the label. */
export const OMP_STATUS_PREFIXES: readonly string[] = [
  ...OMP_WORKING_PREFIXES,
  ...OMP_ATTENTION_PREFIXES,
  `${BRAND} >`,
  `${BRAND}:`,
]

/**
 * `π - <session name> - <cwd>` (or `π - <cwd>` before the session is named).
 * Only the brand + separator is decoration; the rest is what pi chose to call
 * this conversation, so that is what the tab keeps.
 */
export const PI_STATUS_PREFIXES: readonly string[] = [`${BRAND} -`]
