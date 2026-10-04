/**
 * Public top-level subcommands, for `completions` (internal process hosts
 * excluded). Must match `topLevelUsage()` in {@link ./usage.ts}; not derived
 * from the `index.ts` dispatch, so `test/cli/usage.test.ts` catches drift.
 */
export const TOP_LEVEL_SUBCOMMANDS = [
  "completions",
  "add",
  "remove",
  "adopt",
  "export",
  "repo",
  "api",
  "daemon",
  "machine",
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
 * Second-level verbs for `completions`. Import-free on purpose:
 * `daemon-cmd.ts`, `plugin-cmd.ts`, `theme.ts`, `repo-cmd.ts` and
 * `skill-cmd.ts` validate argv against these, so a verb missing here fails
 * loud in the command itself. `api` is excluded (its verbs come from the
 * `VERBS` registry, loaded lazily). Canonical spellings only; aliases
 * (`theme ls`/`rm`) stay in their command module.
 */
export type VerbedSubcommand = "daemon" | "machine" | "plugin" | "repo" | "skill" | "theme"

export const SUBCOMMAND_VERBS: Readonly<Record<VerbedSubcommand, readonly string[]>> = {
  daemon: ["status", "start", "stop", "restart"],
  machine: ["add", "remove", "list"],
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
