/**
 * Worktree pre-trust at spawn time. Each of the four built-ins gates an unseen
 * directory behind a first-run trust dialog that nobody in a hosted session
 * can answer, so the launch stalls (for kimi a stray Enter may even EXIT,
 * depending on the version's default). Vendor store writes live behind the
 * registry's `trustWorktree` hook; this wrapper is best-effort and never
 * blocks a launch.
 *
 * Not every vendor gates. Measured by launching each CLI under a PTY in a
 * fresh git dir and reading the first screen without a key:
 *
 *   - opencode 0.6.3 does NOT gate, even with an empty `HOME`, and has no
 *     trust flag.
 *   - cursor-agent DOES gate: its `--trust` is scoped to `--print`/headless,
 *     unusable for an interactive launch, and it has no `trustWorktree` — a
 *     real gap. (Not observed live: the probe machine stopped at its login
 *     wall, which the CURSOR manifest reports as `blocked`.)
 *   - bob 2.0.4 DOES gate ("Do you trust this folder?"), and its `bob chat
 *     --trust` covers the interactive launch, so its catalog entry carries the
 *     flag instead of needing a hook here.
 *   - gemini / grok / droid / amp / devin / qodercli / cline / kiro / maki / antigravity:
 *     UNVERIFIED. Don't assume either way.
 *
 * A declarative `trustRecord: { file, jsonPath, value }` can't replace this
 * hook: kimi writes a whole file per workspace named
 * `wd_<lowercased basename>_<sha256(realpath)[:12]>` (`kimi-local/trust.ts`).
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
