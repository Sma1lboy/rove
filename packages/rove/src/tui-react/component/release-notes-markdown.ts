/**
 * Release-note body → the markdown the TUI renders. Separate from
 * `./release-notes.tsx` so vitest (no `@opentui/core`) can test it.
 *
 * Changesets bullets open with a PR link and a commit link
 * (`- [#1032](https://…) [`0b99a4c`](https://…) Engines…`). Links are the
 * one thing rewritten: opentui conceals the brackets but keeps `(url)`, and
 * two GitHub URLs push the sentence off the right edge. The label keeps the
 * PR number, sha and author; the URL is one keystroke away on every page
 * that shows notes.
 */

/** `[label](url)` → `label`, leaving the label's own markdown intact. */
const INLINE_LINK = /\[([^\]]*)\]\([^)]*\)/g

export function releaseNotesMarkdown(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(INLINE_LINK, "$1").trim()
}
