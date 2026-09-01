import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { SANDBOX_DAEMON_WEB_PORT, sandboxPortForName } from "./dev-sandbox-args.ts"
import { type FixturePorts, assertFixtureIsolation, buildFixtureEnv, fixtureRuntimePaths } from "./fixture-core.ts"

/** Runtime paths for a sandbox home; callers use these to stop daemon/PTY host. */
export function sandboxRuntimePaths(home: string) {
  return fixtureRuntimePaths(home)
}

/**
 * Build a child environment whose sandbox invariants beat ambient aliases.
 *
 * This drops inherited production path overrides, pins the daemon/PTY socket
 * and pidfiles under the sandbox home, and stamps the web port. The HOME
 * policy is always "redirect": the dev sandbox is a throwaway home.
 */
export function sandboxChildEnv(
  home: string,
  parent: NodeJS.ProcessEnv = process.env,
  name?: string,
): Record<string, string> {
  const root = home.endsWith("/home") ? home.slice(0, -5) : home
  assertFixtureIsolation(home, root)
  const webPort =
    readRoveEnv("SANDBOX_DAEMON_WEB_PORT", parent) ?? (name ? sandboxPortForName(name) : SANDBOX_DAEMON_WEB_PORT)
  const ports: FixturePorts = { daemonWebPort: Number.parseInt(webPort, 10) }
  return buildFixtureEnv({
    root,
    home,
    ports,
    homePolicy: "redirect",
    parentEnv: parent,
    extra: { ROVE_DEV: "1", KOBE_DEV: "1" },
  })
}
