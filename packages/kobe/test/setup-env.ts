/**
 * Ambient-environment isolation for every vitest track (fast, socket,
 * behavior). Runs once per test FILE, before that file's own hooks, so a
 * test that wants a specific home keeps setting it in `beforeEach` and still
 * wins.
 *
 * Without this the suite's result depends on the developer's shell and on
 * where the checkout physically sits. Measured on `main` @ 0.9.103, all three
 * at once from a Rove-managed worktree: 53 failures, 0 of them about the code.
 *
 *   - `ROVE_INVOKED_AS=rove` (every agent session inherits it) flips
 *     `activeCliName()` and 47 `test/cli` assertions on the product name.
 *   - The real `~/.config/rove/state.json` answers `getEngineProtocol()`, so
 *     a registered `claudecpa` preset fails 2 cases in
 *     `test/tui/continue-live-vendor.test.ts` that a fresh machine passes.
 *   - A checkout under `~/.rove/worktrees/` is `roveInternal` to
 *     `pathRejection()`, failing 4 cases across `project-eligibility` and
 *     `open-dir-cmd` — which is where every dispatched worker runs.
 *
 * The home is redirected via `KOBE_HOME_DIR` and `ROVE_HOME_DIR` is DELETED
 * rather than set: `readRoveEnv()` reads `ROVE_*` first, so an ambient
 * `ROVE_HOME_DIR` would shadow the ~288 tests that set only `KOBE_HOME_DIR`
 * in their own hooks (measured: 180 failures when both are set here).
 */

import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Ambient `KOBE_*` / `ROVE_*` names a run may legitimately read from the
 * developer's shell. Every other one is deleted — a list of what to keep
 * cannot rot the way a list of what to strip does.
 */
const AMBIENT_KEEP = new Set([
  "KOBE_UPDATE_GOLDEN", // regenerates golden files on purpose
  "KOBE_INCLUDE_SOCKET",
  "KOBE_INCLUDE_BEHAVIOR",
  "KOBE_COVERAGE_DAEMON",
])

for (const key of Object.keys(process.env)) {
  if ((key.startsWith("KOBE_") || key.startsWith("ROVE_")) && !AMBIENT_KEEP.has(key)) {
    Reflect.deleteProperty(process.env, key)
  }
}

// Engine config roots. Not `ROVE_*`-prefixed, but they steer which transcript
// store the history readers see, so an agent shell that exports one would
// point unit tests at real sessions.
Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR")
Reflect.deleteProperty(process.env, "CODEX_HOME")

// One empty home per worker process — enough isolation that no test reads the
// developer's saved repos or presets, few enough directories that a run does
// not litter tmpdir with one per test file. `tmpdir()`, never a literal
// `/tmp`: `pathRejection()` decides `roveInternal` before `temporary`, so a
// home under a temp root still reports the specific reason.
const home = join(tmpdir(), `rove-vitest-home-${process.pid}`)
mkdirSync(home, { recursive: true })
process.env.KOBE_HOME_DIR = home

// Fixture repos run `git init && git commit` inheriting `process.env`, so the
// developer's `~/.gitconfig` applied: `commit.gpgsign = true` passes only
// while a gpg agent answers. One variable each covers signing, hooks,
// templates, `core.autocrlf` and `init.defaultBranch`.
process.env.GIT_CONFIG_GLOBAL = "/dev/null"
process.env.GIT_CONFIG_SYSTEM = "/dev/null"
