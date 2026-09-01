/**
 * The house border style, in one place.
 *
 * opentui hard-codes `borderStyle: "single"` (square corners) as its Box
 * default and offers no global override, so every framed surface in the TUI
 * has to opt into rounded corners itself. That is a rule nobody can follow
 * reliably from memory: half the framed boxes in `tui-react` said `border`
 * and nothing else, and each shipped square until somebody noticed it looked
 * foreign beside its neighbours — the workspace pane, the files pane and the
 * tab strip were rounded while the kanban board, the prefix HUD, the context
 * menu and the story dialog were not.
 *
 * Spread this instead of writing `border` by hand:
 *
 *     <box {...FRAME} borderColor={theme.border}>
 *
 * The point is not saving two words. It is that the next framed box comes out
 * rounded because its author spread the shared thing, rather than because they
 * remembered a prop whose absence is invisible in review and only surfaces as
 * a corner glyph in a screenshot.
 */

/** Border props every framed surface spreads. Rounded — see the module note. */
export const FRAME = { border: true, borderStyle: "rounded" } as const
