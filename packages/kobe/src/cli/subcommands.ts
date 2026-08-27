/**
 * Top-level kobe subcommands (user-facing) — the source `kobe completions`
 * reads to build its shell completion scripts.
 *
 * This must stay in lock-step with the command list rendered by
 * {@link ./usage.ts}'s `topLevelUsage()` (the `kobe --help` text). That
 * invariant is enforced by a test (`test/cli/usage.test.ts`), so adding or
 * removing a public subcommand fails CI until both lists agree — they are NOT
 * auto-derived from the `index.ts` dispatch, so the test is what catches drift.
 *
 * Internal process hosts are not included in the public completion list.
 */
export const TOP_LEVEL_SUBCOMMANDS = [
  "web",
  "completions",
  "add",
  "remove",
  "adopt",
  "export",
  "repo",
  "api",
  "daemon",
  "doctor",
  "config",
  "reset",
  "theme",
  "skill",
  "plugin",
  "feedback",
  "update",
] as const

/**
 * Sub-verbs of the top-level commands that take one — the second level
 * `kobe completions` offers.
 *
 * This module has no imports on purpose, so the dependency runs the other
 * way: `daemon-cmd.ts`, `plugin-cmd.ts`, `theme.ts`, `repo-cmd.ts` and
 * `skill-cmd.ts` each validate their argv against the entry below instead of
 * keeping a private list. A verb missing from here is therefore unreachable
 * in the command itself, not merely absent from the completion script — the
 * drift fails loud at the first invocation rather than silently telling a
 * user the verb doesn't exist.
 *
 * `api` is deliberately NOT here: its verbs come from the `VERBS` registry
 * (`api/verbs.ts`, the same one `kobe api schema` enumerates), which
 * `completions-cmd.ts` loads lazily so this module stays import-free.
 *
 * Canonical spellings only. Aliases (`theme ls`/`rm`) stay in their command
 * module — completing both spellings is noise.
 */
export type VerbedSubcommand = "daemon" | "plugin" | "repo" | "skill" | "theme"

export const SUBCOMMAND_VERBS: Readonly<Record<VerbedSubcommand, readonly string[]>> = {
  daemon: ["status", "start", "stop", "restart"],
  plugin: [
    "install",
    "link",
    "list",
    "search",
    "outdated",
    "update",
    "enable",
    "disable",
    "unlink",
    "uninstall",
    "config-dir",
    "log",
    "action",
    "pane",
  ],
  repo: ["show", "set", "unset"],
  skill: ["install", "status", "command", "print"],
  theme: ["list", "add", "remove"],
}
