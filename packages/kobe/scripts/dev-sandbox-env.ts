import { assertFixtureIsolation, buildFixtureEnv, fixtureRuntimePaths } from "./fixture-core.ts"

/** Runtime paths for a sandbox home; callers use these to stop daemon/PTY host. */
export function sandboxRuntimePaths(home: string) {
  return fixtureRuntimePaths(home)
}

/**
 * Build a child environment whose sandbox invariants beat ambient aliases.
 *
 * This drops inherited production path overrides and pins the daemon/PTY
 * socket and pidfiles under the sandbox home. `HOME` stays
 * the operator's: only Rove's own state (`*_HOME_DIR`) is thrown away, so the
 * engines under test see the same credentials, accounts, and vendor set as
 * production — a redirected HOME made every engine look logged-out and the
 * sandbox stopped reproducing what users run.
 */
export function sandboxChildEnv(home: string, parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const root = home.endsWith("/home") ? home.slice(0, -5) : home
  assertFixtureIsolation(home, root)
  return buildFixtureEnv({
    root,
    home,
    // No ports: a sandbox instance is isolated by its home and its sockets.
    ports: {},
    homePolicy: "keep",
    parentEnv: parent,
    extra: { ROVE_DEV: "1", KOBE_DEV: "1" },
  })
}
