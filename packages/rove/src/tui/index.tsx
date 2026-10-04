/** TUI entry: plain `rove` starts the Workspace Host. Daemon recovery is `rove daemon restart`. */

import { ensureGlobalRoveHooks } from "../cli/hook-cmd.ts"
import { enforceResetGate } from "../cli/reset-gate.ts"
import { takeWelcome } from "../cli/welcome.ts"
import { takeWhatsNew } from "../cli/whats-new.ts"
import { maybeHintSkillInstall } from "../lib/skill-install.ts"
import { publishRoveTerminalTitle } from "./lib/outer-terminal-title.ts"

export async function startTui(): Promise<void> {
  // Before the reset gate, which overwrites the `app.lastRunVersion` stamp
  // this falls back to for installs predating its own key.
  const whatsNewFrom = takeWhatsNew()
  // Same ordering rule: reads `app.lastRunVersion` to tell a first run from an
  // existing user.
  const welcome = takeWelcome()

  // Breaking-version gate first: refuse to touch daemon/session state that
  // a version in BREAKING_VERSIONS made incompatible (run `rove reset`).
  enforceResetGate()

  // Own the emulator's tab title; without an OSC title iTerm2 shows the
  // packaged runtime name ("node").
  publishRoveTerminalTitle()

  // Before the screen takeover: hint once if the agent skill is absent, or
  // prompt yes/no/don't-notify-this-version if stale. Best-effort; the reliable
  // check is `rove skill status`.
  await maybeHintSkillInstall()

  // Finish the idempotent settings merge before any engine launches, so its
  // first activity events are observable.
  await ensureGlobalRoveHooks()

  // Plugin engines ([[engines]] in enabled manifests) before the host, so every
  // surface sees them from the first frame.
  const { loadPluginEngines } = await import("../engine/plugin-engines.ts")
  loadPluginEngines()

  const { startWorkspaceHost } = await import("../tui-react/workspace/start-workspace.tsx")
  await startWorkspaceHost({ whatsNewFrom, welcome })
}
