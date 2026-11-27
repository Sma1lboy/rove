/**
 * Rove release-notes format: wraps @changesets/changelog-github and moves its
 * "Thanks [@user](…)! - " preamble to the tail of each patch line, so entries
 * read "<commit> summary — @user" (owner call, 2026-08-25).
 *
 * A body's leading client tags (`[web][ios] …`) become `**web · ios** …`: bold
 * reads as a label on GitHub and in both clients' renderers, where `[web]`
 * would sit next to the PR link's `[#123](…)` and read as a broken link.
 * Clients parse it back (packages/rove/src/lib/release-note-clients.ts).
 */
import changelogGithub from "@changesets/changelog-github"

const THANKS = /Thanks (\[@[^\]]+\]\([^)]+\))! - /

/** Kept in step with NOTE_CLIENTS in packages/rove/src/lib/release-note-clients.ts. */
export const CLIENTS = ["web", "tui", "ios", "android", "cli", "daemon"]
const TAGS = /^\s*((?:\[[a-z]+\][ \t]*)+)/
/** The `author:` / `pr:` / `commit:` override lines changelog-github reads before the summary. */
const OVERRIDES = /^(?:\s*(?:pr|pull|pull\s+request|commit|author|user)\s*:[^\n]*\n)*/i

/** The client tags a changeset body opens with (after any override lines), or null when it has none or names an unknown client. */
export function leadingClientTags(summary) {
  const head = OVERRIDES.exec(summary)[0]
  const m = TAGS.exec(summary.slice(head.length))
  if (!m) return null
  const names = [...m[1].matchAll(/\[([a-z]+)\]/g)].map((t) => t[1])
  return names.every((n) => CLIENTS.includes(n)) ? { names, head, rest: summary.slice(head.length + m[0].length) } : null
}

const getReleaseLine = async (changeset, type, options) => {
  const tags = leadingClientTags(changeset.summary)
  const summary = tags ? `${tags.head}**${tags.names.join(" · ")}** ${tags.rest}` : changeset.summary
  const line = await changelogGithub.getReleaseLine({ ...changeset, summary }, type, options)
  const m = line.match(THANKS)
  if (!m) return line
  return `${line.replace(m[0], "").trimEnd()} — ${m[1]}`
}

export default {
  getDependencyReleaseLine: changelogGithub.getDependencyReleaseLine,
  getReleaseLine,
}
