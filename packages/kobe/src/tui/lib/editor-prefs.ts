/**
 * Editor preference keys + normalization, IO-free, so Settings can use them via
 * its reactive `kv` and `editor-launch.ts` agrees on the same keys.
 */

/**
 * What `files.open` (enter) launches:
 *  - `auto` (default): $VISUAL / $EDITOR, else the first installed of
 *    nvim → vim → emacs → nano.
 *  - `vim` / `nvim` / `nano` / `emacs`: force that editor.
 *  - `custom`: run `editor.customCommand` (e.g. `code -w`, `emacsclient`).
 */
export type EditorKind = "auto" | "vim" | "nvim" | "nano" | "emacs" | "custom"

/** Cycle order for the Settings select row. */
export const EDITOR_KINDS: readonly EditorKind[] = ["auto", "vim", "nvim", "nano", "emacs", "custom"]

/** Auto-detect probe order when $VISUAL / $EDITOR are unset. */
export const AUTO_EDITOR_CANDIDATES: readonly string[] = ["nvim", "vim", "emacs", "nano"]

/** Shared `state.json` keys. */
export const EDITOR_KIND_KEY = "editor.kind"
export const EDITOR_CUSTOM_KEY = "editor.customCommand"

export const DEFAULT_EDITOR_KIND: EditorKind = "auto"

/** Unknown persisted value → `auto`. */
export function normalizeEditorKind(value: unknown): EditorKind {
  return EDITOR_KINDS.includes(value as EditorKind) ? (value as EditorKind) : DEFAULT_EDITOR_KIND
}
