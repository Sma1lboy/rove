/**
 * Where the local `claude` CLI binary lives.
 *
 * Search order ported from `refs/opcode/src-tauri/src/claude_binary.rs` —
 * we strip the version-comparison + DB-preference machinery (opcode
 * stores a chosen path in SQLite) and keep just the order:
 *
 *   1. `$PATH` (the user's shell — `which claude`).
 *   2. `~/.claude/local/claude`  (Claude Code's bundled-update install).
 *   3. NVM-active (`$NVM_BIN/claude`).
 *   4. NVM versions (`~/.nvm/versions/node/<v>/bin/claude` — newest
 *      first, compared numerically).
 *   5. Homebrew + system paths (`/opt/homebrew/bin`, `/usr/local/bin`,
 *      `/usr/bin`, `/bin`).
 *   6. Misc user installs (`~/.local/bin`, `~/.npm-global/bin`,
 *      `~/.yarn/bin`, `~/.bun/bin`, `~/bin`).
 *
 * The first hit wins. We do *not* run `--version` to pick the newest —
 * that costs a subprocess per candidate and the user's shell PATH is
 * almost always the right answer. If the user has a strong preference
 * they can put it on PATH.
 *
 * The probing itself (`which`, stat, the checked-path ledger) lives in
 * `../binary-discovery.ts`.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder } from "../binary-discovery.ts"

export type { BinaryDiscoveryDeps } from "../binary-discovery.ts"

/** Thrown when `findClaudeBinary` cannot locate `claude` anywhere we look. */
export class ClaudeBinaryNotFoundError extends BinaryNotFoundError {
  constructor(checkedPaths: readonly string[]) {
    super("Claude Code binary", "Ensure 'claude' is on PATH, or install at ~/.claude/local/claude.", checkedPaths)
    this.name = "ClaudeBinaryNotFoundError"
  }
}

/** Locate the `claude` binary on this machine. */
export const findClaudeBinary = createBinaryFinder({
  name: "claude",
  candidates({ deps, home }) {
    const out = [path.join(home, ".claude", "local", "claude")]

    const nvmBin = deps.env("NVM_BIN")
    if (nvmBin) out.push(path.join(nvmBin, "claude"))

    // All NVM-installed node versions, newest first. A plain string sort
    // mis-orders unpadded semver dir names ("v8.17.0" sorts after "v18.20.0"),
    // so a single-digit major would shadow newer nodes; compare numerically.
    const nvmRoot = path.join(home, ".nvm", "versions", "node")
    const versions = (deps.readdir?.(nvmRoot) ?? []).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const v of versions) out.push(path.join(nvmRoot, v, "bin", "claude"))

    out.push("/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude", "/bin/claude")

    for (const rel of [".local/bin", ".npm-global/bin", ".yarn/bin", ".bun/bin", "bin"]) {
      out.push(path.join(home, rel, "claude"))
    }
    return out
  },
  notFound: (checked) => new ClaudeBinaryNotFoundError(checked),
})
