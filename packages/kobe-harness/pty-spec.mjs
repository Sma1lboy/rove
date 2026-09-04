/**
 * Launch-spec resolution for the PTY sidecar: the hop that turns a
 * `(taskId, mode)` pair into the `{ cwd, command }` a browser tab's terminal
 * is spawned from.
 *
 * There is exactly one way to resolve a spec now: `KOBE_PTY_DEV_COMMAND`.
 * This used to fall back to the daemon's `/api/engine-spec` and
 * `/api/terminal-spec` routes, but #855 deleted the daemon's HTTP transport
 * entirely — `packages/kobe-daemon/src` is `node:net` and nothing else — so
 * that branch could no longer reach a listener on any port. Every runner that
 * touches the sidecar already set the variable (`playwright.config.ts`,
 * `e2e/visual-serve.ts`, `e2e/hero-serve.ts`) and returned before the hop, so
 * removing it changes no reachable behavior.
 *
 * The unset case throws by name rather than returning `undefined`: a missing
 * spec would otherwise surface as a `TypeError` deep in
 * `pty-session-lifecycle.mjs` and present to the user as a blank terminal with
 * no explanation.
 */

/**
 * Build the sidecar's spec fetcher.
 *
 * `env` is a parameter rather than a direct `process.env` read so the sidecar's
 * collaborators stay injectable, the way every other helper in this directory
 * takes them (`pty-auth`, `pty-env`, `pty-scrollback`,
 * `pty-session-lifecycle`, `origin-policy`).
 *
 * @param {object} [opts]
 * @param {Record<string, string | undefined>} [opts.env]
 * @returns {(taskId: string, mode: "engine" | "shell") => Promise<{ cwd: string, command: string[], firstMessage?: string }>}
 */
export function createSpecFetcher({ env = process.env } = {}) {
  return async function fetchSpec(_taskId, _mode) {
    // e2e/dev harness override: run an arbitrary TUI (dev:mock / dev:sandbox) in
    // the PTY so a Playwright test can drive the real TUI through the web
    // terminal with no daemon or task. Since #855 this is the only source of a
    // launch spec, so `mode` no longer selects between two routes.
    if (!env.KOBE_PTY_DEV_COMMAND) {
      throw new Error(
        "KOBE_PTY_DEV_COMMAND is unset — the sidecar has no other way to resolve a launch spec since the daemon web transport was removed in 0.9.x",
      )
    }
    return {
      cwd: env.KOBE_PTY_DEV_CWD ?? process.cwd(),
      command: ["/bin/sh", "-lc", env.KOBE_PTY_DEV_COMMAND],
    }
  }
}
