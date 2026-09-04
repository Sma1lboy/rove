/**
 * Launch-spec resolution for the PTY sidecar: the hop that turns a
 * `(taskId, mode)` pair into the `{ cwd, command }` a browser tab's terminal
 * is spawned from, by asking the daemon's web transport.
 *
 * This lives outside `pty-server.mjs` because that file exports nothing and
 * starts an HTTP server at import time, so the function was unreachable from
 * any test — while every runner that touches the sidecar sets
 * `KOBE_PTY_DEV_COMMAND` (`playwright.config.ts`, `e2e/visual-serve.ts`,
 * `e2e/hero-serve.ts`) and returns before the daemon hop entirely. A web
 * terminal broken from 0.9.60 to 0.9.102 stayed green through ~40 CI runs on
 * exactly that gap. Collaborators are parameters here, the way every other
 * helper in this directory takes them (`pty-auth`, `pty-env`,
 * `pty-scrollback`, `pty-session-lifecycle`, `origin-policy`).
 */

import { expectedPtyToken } from "./pty-auth.mjs"

/**
 * Build the sidecar's spec fetcher.
 *
 * `readToken` is a function, not a value: the daemon may mint the token file
 * after this process starts, and `expectedPtyToken` memoizes only once it has
 * a non-empty answer — capturing a token at construction time would wedge the
 * gate shut for the process lifetime.
 *
 * @param {object} opts
 * @param {number} opts.port daemon web transport port
 * @param {(env?: Record<string, string | undefined>) => string} [opts.readToken]
 * @param {Record<string, string | undefined>} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {(taskId: string, mode: "engine" | "shell") => Promise<{ cwd: string, command: string[], firstMessage?: string }>}
 */
export function createSpecFetcher({ port, readToken = expectedPtyToken, env = process.env, fetchImpl = fetch }) {
  return async function fetchSpec(taskId, mode) {
    // e2e/dev harness override: run an arbitrary TUI (dev:mock / dev:sandbox) in
    // the PTY instead of resolving a task's engine via the daemon — so a Playwright
    // test can drive the real TUI through the web terminal with no daemon or task.
    if (env.KOBE_PTY_DEV_COMMAND) {
      return {
        cwd: env.KOBE_PTY_DEV_CWD ?? process.cwd(),
        command: ["/bin/sh", "-lc", env.KOBE_PTY_DEV_COMMAND],
      }
    }
    const path = mode === "shell" ? "/api/terminal-spec" : "/api/engine-spec"
    // `/api/*` on the daemon requires the bearer token like every other caller
    // does; without it a real tab dies at "unauthorized: this request carried no
    // valid web token" before any PTY is spawned.
    const token = readToken(env)
    const res = await fetchImpl(`http://localhost:${port}${path}?taskId=${encodeURIComponent(taskId)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    const json = await res.json()
    if (!res.ok || json.error) throw new Error(json.error ?? `engine-spec failed (${res.status})`)
    return json // { cwd, command: string[], firstMessage?: string }
  }
}
