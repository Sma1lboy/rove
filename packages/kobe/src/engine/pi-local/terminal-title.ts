/**
 * The pi family's OSC 0/2 title policy — the vendor-specific half of
 * `../terminal-title.ts`.
 *
 * Captured from raw PTY bytes replayed through xterm:
 *
 *   omp 18.1.17 writes `π <separator> <label>`: a braille spinner frame while
 *   a turn runs, `>` at rest, `!` when blocked on a human; `π: <label>` when
 *   `tui.titleState` is off. An unnamed session's label is the cwd basename.
 *
 *   pi 0.80.6 writes only `π - <session name> - <cwd>` (name omitted until
 *   set): no run state, so its policy claims no `workingPrefixes` and
 *   `ownsStatus: false`; Rove's turn glyph is the only state shown.
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

/** Only `π -` is decoration; the tab keeps the rest as pi's name for the session. */
export const PI_STATUS_PREFIXES: readonly string[] = [`${BRAND} -`]
