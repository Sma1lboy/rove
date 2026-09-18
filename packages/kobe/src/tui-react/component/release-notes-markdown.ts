/**
 * Release-note body → the markdown the TUI actually renders.
 *
 * Kept apart from `./release-notes.tsx` because that file imports
 * `@opentui/core`, which vitest can't load — this half is a pure string
 * transform and is unit-tested under `test:fast`.
 *
 * The bodies are Changesets output: a `### Patch Changes` heading over
 * bullets that each open with a PR link and a commit link before the
 * sentence — `- [#1032](https://…/pull/1032) [`0b99a4c`](https://…) Engines
 * outside the built-in six…`. Everything else in them (headings, nested
 * bullets, `code`, **bold**) renders as markdown; links are the one
 * construct we rewrite, because opentui's markdown grammar conceals a
 * link's brackets but keeps its `(url)`, and two full GitHub URLs per
 * bullet push the sentence someone came to read off the right edge. The
 * label carries the PR number, the sha and the author handle, which is
 * what a reader scans for; the address itself is one keystroke away on
 * every page that shows notes (the release action, or the source URL in
 * the footer).
 */

/** `[label](url)` → `label`, leaving the label's own markdown intact. */
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g

export function releaseNotesMarkdown(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(INLINE_LINK, "$1").trim()
}
