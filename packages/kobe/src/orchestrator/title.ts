/** Title helpers + placeholder-branch recognition. Branch names come from `branch-style.ts`. */

/** Title cap. Kept generous for branch slugs; the compact sidebar truncates visually. */
export const TITLE_CHAR_CAP = 40

/**
 * Placeholder title before a task gets a real name. Single source of truth:
 * `followBranchToTitle` re-derives this placeholder's branch and compares
 * byte-for-byte, so a drifted private copy silently breaks first-rename
 * branch-following with no compile or test signal. Always import it.
 */
export const PLACEHOLDER_TASK_TITLE = "(new task)"

/**
 * Flatten a title to one trimmed line. Called at both orchestrator entry
 * points (`createTask`, `setTitle`) so RPC titles are covered too.
 * `lib/display-width.ts` measures every codepoint below `0x20` as zero cells,
 * so a newline slips past the truncator and blows the sidebar row open; all C0
 * controls (incl. raw `\x1b`) share that problem. Runs collapse to one space
 * so `"line1\nline2"` stays two words.
 */
export function sanitizeTaskTitle(title: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: these bytes are exactly what the sidebar cannot render.
  return title.replace(/[\u0000-\u0020\u007f]+/g, " ").trim()
}

/**
 * Reduce an arbitrary user prompt to a one-line sidebar label.
 */
export function deriveTitleFromPrompt(prompt: string): string {
  if (typeof prompt !== "string") return ""
  const collapsed = prompt.replace(/\s+/g, " ").trim()
  if (collapsed.length === 0) return ""
  // Truncate on code points: `.slice` can bisect a surrogate pair and leave a
  // replacement glyph.
  const points = [...collapsed]
  if (points.length <= TITLE_CHAR_CAP) return collapsed
  return `${points.slice(0, TITLE_CHAR_CAP).join("")}…`
}

/**
 * Whether `branch` is still an untouched placeholder default for `taskId` —
 * `TaskEditor.followBranchToTitle` uses it to follow the first rename at most
 * once. Accepts the `new-task` slug (optionally type-prefixed and/or
 * `-N`-suffixed) and the legacy `rove/` / `kobe/` `new-task-<id6>` spellings.
 */
export function isPlaceholderDerivedBranch(branch: string, taskId: string): boolean {
  const id6 = taskId.slice(-6).toLowerCase()
  if (branch === `rove/new-task-${id6}` || branch === `kobe/new-task-${id6}`) return true
  return /^(?:[^/]+\/)?new-task(?:-\d+)?$/.test(branch)
}
