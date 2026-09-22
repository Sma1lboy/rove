/**
 * Locate the `claude` binary. Search order from
 * `refs/opcode/src-tauri/src/claude_binary.rs`: `$PATH`, then the candidates
 * below in order. First hit wins — no `--version` probing (a subprocess per
 * candidate; PATH is almost always right).
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

export const findClaudeBinary = createBinaryFinder({
  name: "claude",
  candidates({ deps, home }) {
    const out = [path.join(home, ".claude", "local", "claude")]

    const nvmBin = deps.env("NVM_BIN")
    if (nvmBin) out.push(path.join(nvmBin, "claude"))

    // Newest first, numerically: a string sort puts "v8.17.0" after "v18.20.0".
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
