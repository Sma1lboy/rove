/**
 * Dynamic command dispatch entries for `src/cli/index.ts`.
 *
 * Heavy or rarely-used subcommands are dynamically imported so a bare
 * `kobe add` does not pull in the TUI, opentui, or plugin machinery. The
 * table is split out here to keep `index.ts` under the file-size cap; the
 * three inline handlers (`add`, `remove`, `adopt`) stay in `index.ts` and are
 * merged into the final table there.
 */

export type CommandHandler = (args: string[]) => Promise<void>

export const DYNAMIC_COMMANDS = new Map<string, CommandHandler>([
  [
    "completions",
    async (args) => {
      const { runCompletionsSubcommand } = await import("./completions-cmd.ts")
      await runCompletionsSubcommand(args)
    },
  ],
  [
    "export",
    async (args) => {
      const { runExportSubcommand } = await import("./export-cmd.ts")
      await runExportSubcommand(args)
    },
  ],
  [
    "repo",
    async (args) => {
      const { runRepoSubcommand } = await import("./repo-cmd.ts")
      await runRepoSubcommand(args)
    },
  ],
  [
    "api",
    async (args) => {
      const { runApiSubcommand } = await import("./api-cmd.ts")
      await runApiSubcommand(args)
    },
  ],
  [
    "update",
    async (args) => {
      const { runUpdateSubcommand } = await import("./update.ts")
      await runUpdateSubcommand(args)
    },
  ],
  [
    "theme",
    async (args) => {
      const { runThemeSubcommand } = await import("./theme.ts")
      await runThemeSubcommand(args)
    },
  ],
  [
    "feedback",
    async (args) => {
      const { runFeedbackSubcommand } = await import("./feedback-cmd.ts")
      await runFeedbackSubcommand(args)
    },
  ],
  [
    "daemon",
    async (args) => {
      const { runDaemonSubcommand } = await import("./daemon-cmd.ts")
      await runDaemonSubcommand(args)
    },
  ],
  [
    "doctor",
    async (args) => {
      const { runDoctorSubcommand } = await import("./doctor-cmd.ts")
      await runDoctorSubcommand(args)
    },
  ],
  [
    "config",
    async (args) => {
      const { runConfigSubcommand } = await import("./config-cmd.ts")
      await runConfigSubcommand(args)
    },
  ],
  [
    "reset",
    async (args) => {
      const { runResetSubcommand } = await import("./reset-cmd.ts")
      await runResetSubcommand(args)
    },
  ],
  [
    "pty-host",
    async (args) => {
      // Internal (spawned detached by the terminal pane's
      // ensurePtyHostReachable): the standalone process that owns embedded
      // terminal PTYs so they survive TUI exits and daemon restarts.
      const { runPtyHostSubcommand } = await import("./pty-host-cmd.ts")
      await runPtyHostSubcommand(args)
    },
  ],
  [
    "web",
    async (args) => {
      const { runWebSubcommand } = await import("./web-cmd.ts")
      await runWebSubcommand(args)
    },
  ],
  [
    "skill",
    async (args) => {
      // Install / inspect the kobe agent skill that ships in this package.
      const { runSkillSubcommand } = await import("./skill-cmd.ts")
      await runSkillSubcommand(args)
    },
  ],
  [
    "plugin",
    async (args) => {
      const { runPluginSubcommand } = await import("./plugin-cmd.ts")
      await runPluginSubcommand(args)
    },
  ],
  [
    "hook",
    async (args) => {
      // Internal: fired by an engine's hooks inside a task worktree to report a
      // normalized activity event to the daemon (event-driven task state).
      // Always exits 0; never spawns the daemon.
      const { runHookSubcommand } = await import("./hook-cmd.ts")
      await runHookSubcommand(args)
    },
  ],
])
