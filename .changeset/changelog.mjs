/**
 * Rove release-notes format: wraps @changesets/changelog-github and moves its
 * "Thanks [@user](…)! - " preamble to the tail of each patch line, so entries
 * read "<commit> summary — @user" (owner call, 2026-08-25).
 */
import changelogGithub from "@changesets/changelog-github"

const THANKS = /Thanks (\[@[^\]]+\]\([^)]+\))! - /

const getReleaseLine = async (changeset, type, options) => {
  const line = await changelogGithub.getReleaseLine(changeset, type, options)
  const m = line.match(THANKS)
  if (!m) return line
  return `${line.replace(m[0], "").trimEnd()} — ${m[1]}`
}

export default {
  getDependencyReleaseLine: changelogGithub.getDependencyReleaseLine,
  getReleaseLine,
}
