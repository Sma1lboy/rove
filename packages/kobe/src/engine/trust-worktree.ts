/**
 * Worktree pre-trust at spawn time. A Rove-created worktree is a directory the
 * engine has never seen, and each of the four BUILT-INS gates that behind a
 * first-run trust dialog a hosted session cannot answer — nobody is at the pane
 * to press a key, so the launch stalls on the dialog instead of starting the
 * turn. (Kimi's is the loudest failure: whether a stray Enter accepts or EXITS
 * the process depends on which option that kimi version defaults to.) The
 * vendor-specific store writes live behind the registry's `trustWorktree` hook;
 * THIS wrapper owns the call policy every spawn path shares: best-effort, never
 * blocks a launch (a failed write just leaves the dialog in the user's way).
 *
 * "Every vendor" is what this said before, and it is not true — measured
 * 2026-09-04, launching each installed CLI under a PTY in a fresh git
 * directory and reading the first screen without sending a key:
 *
 *   - opencode 0.6.3 does NOT gate. It lands on its composer (`enter send`)
 *     both with the user's real config and with an EMPTY `HOME`, where every
 *     directory is unseen and a per-directory gate would have to fire. It has
 *     no trust flag in `--help` either. So a contrib engine getting
 *     `undefined` here is not automatically a stalled launch.
 *   - cursor-agent DOES gate: its own `--help` carries `--trust  Trust the
 *     current workspace without prompting`, and scopes that flag to
 *     `--print`/headless — which is exactly the escape hatch Rove's
 *     interactive launch cannot use. It is a shipped contrib engine with no
 *     `trustWorktree`, so this gap is real, just not universal. (Not observed
 *     live: the cursor-agent on the probe machine stops at its login wall,
 *     which the CURSOR screen manifest already reports as `blocked`.)
 *   - gemini / grok / droid / amp: UNVERIFIED — not installed on the machine
 *     this was measured on. Do not assume either way.
 *
 * A note for whoever closes the cursor gap: the obvious shape — a declarative
 * `trustRecord: { file, jsonPath, value }` a manifest could express — does not
 * cover what is already here. Three built-ins do merge one key into one config
 * file, but kimi writes a whole FILE PER WORKSPACE whose NAME is
 * `wd_<lowercased basename>_<sha256(realpath)[:12]>` (see `kimi-local/trust.ts`).
 * A record format that cannot express kimi cannot replace this hook.
 */

import type { VendorId } from "../types/vendor.ts"
import { protocolEntry } from "./engine-presets.ts"

export function trustEngineWorktree(vendor: VendorId | undefined, worktreePath: string): void {
  try {
    protocolEntry(vendor).trustWorktree?.(worktreePath)
  } catch {
    /* best-effort — see the module doc */
  }
}
