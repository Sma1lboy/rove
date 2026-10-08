/**
 * `rove demo-session` (INTERNAL, spawned by the opt-in demo engine's launch
 * command): replays the scripted session in this PTY. Excluded from
 * `TOP_LEVEL_SUBCOMMANDS`, like `pty-host` — it is a process host, not a verb
 * a user types. See `src/demo/` and `docs/ENGINES.md`.
 */

import { demoRunOptions, runDemoSession } from "../demo/run.ts"

export async function runDemoSessionSubcommand(_argv: readonly string[]): Promise<void> {
  process.exit(await runDemoSession(demoRunOptions()))
}
