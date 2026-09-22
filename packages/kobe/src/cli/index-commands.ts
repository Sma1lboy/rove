/**
 * Lazy dispatch entries for `index.ts`: only `import()` thunks, since any
 * static import here is paid on EVERY CLI invocation (a bare `add` must not
 * load the TUI/opentui/plugins). The cheap `add`/`remove`/`adopt` handlers
 * stay in `index.ts`.
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
    "machine",
    async (args) => {
      const { runMachineSubcommand } = await import("./machine-cmd.ts")
      await runMachineSubcommand(args)
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
      // Internal (spawned detached by ensurePtyHostReachable): owns terminal
      // PTYs so they survive TUI exits and daemon restarts.
      const { runPtyHostSubcommand } = await import("./pty-host-cmd.ts")
      await runPtyHostSubcommand(args)
    },
  ],
  [
    "skill",
    async (args) => {
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
      // Internal: engine hooks report activity events to the daemon.
      // Always exits 0; never spawns the daemon.
      const { runHookSubcommand } = await import("./hook-cmd.ts")
      await runHookSubcommand(args)
    },
  ],
])
