/**
 * `bun e2e/hero-serve.ts` — the warm capture stack for README/docs assets:
 * Vite + the PTY sidecar on the hero ports, wired to the isolated hero home.
 * Keep it running, then shoot with `hero-shot.ts` / `hero-record.ts`.
 *
 * Deliberately does NOT rebuild its fixture on start (unlike `visual:serve`):
 * the hero home holds real engine transcripts that cost quota, and a capture
 * session re-frames the same sessions many times.
 */

import { existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  HERO_HOME,
  HERO_PTY_PORT,
  HERO_WEB_PORT,
  KOBE_DIR,
  assertHeroIsolation,
  ensureCaptureShell,
  heroEnv,
  heroPtyCommand,
} from "./hero-env.ts"

if (!existsSync(HERO_HOME)) throw new Error(`no hero fixture at ${HERO_HOME} — run \`bun e2e/hero-fixture.ts --fresh\``)
assertHeroIsolation()
// Before anything spawns a shell: the PTY host reads `ZDOTDIR` at boot.
ensureCaptureShell()

const child = Bun.spawn(["bun", "run", "dev.ts"], {
  cwd: resolve(import.meta.dirname, ".."),
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...heroEnv(),
    KOBE_WEB_PORT: String(HERO_WEB_PORT),
    ROVE_WEB_PORT: String(HERO_WEB_PORT),
    KOBE_PTY_PORT: String(HERO_PTY_PORT),
    ROVE_PTY_PORT: String(HERO_PTY_PORT),
    KOBE_PTY_DEV_CWD: KOBE_DIR,
    KOBE_PTY_DEV_COMMAND: heroPtyCommand(),
    // The capture runs this branch's build, which is usually a release behind
    // npm, and the sidebar would film an "↑ <next version>" badge. A fake
    // latest BELOW any real version reads as "no update" (see `version.ts`).
    KOBE_FAKE_UPDATE: "0.0.0",
    // Git Bash's login profile cd's to $HOME unless told the caller chose the cwd.
    ...(process.platform === "win32" ? { KOBE_PTY_DEV_SHELL: "C:/Program Files/Git/bin/sh.exe", CHERE_INVOKING: "1" } : {}),
  },
})

console.error(`[hero:serve] warm on :${HERO_WEB_PORT} — hero-shot / hero-record; ctrl-c to stop`)
process.on("SIGINT", () => child.kill())
process.on("SIGTERM", () => child.kill())
process.exit(await child.exited)
