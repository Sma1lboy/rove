/**
 * Where the local `codex` CLI binary lives: `$PATH`, then homebrew and the
 * system dirs, then the active nvm bin, then the usual per-user dirs.
 * Probing itself lives in `../binary-discovery.ts`.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder } from "../binary-discovery.ts"

export type { BinaryDiscoveryDeps } from "../binary-discovery.ts"

export class CodexBinaryNotFoundError extends BinaryNotFoundError {
  constructor(checkedPaths: readonly string[]) {
    super(
      "Codex CLI binary",
      "Ensure 'codex' is on PATH (e.g. `brew install codex` or the official installer).",
      checkedPaths,
    )
    this.name = "CodexBinaryNotFoundError"
  }
}

export const findCodexBinary = createBinaryFinder({
  name: "codex",
  candidates({ deps, home }) {
    const out = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/usr/bin/codex", "/bin/codex"]
    const nvmBin = deps.env("NVM_BIN")
    if (nvmBin) out.push(path.join(nvmBin, "codex"))
    for (const rel of [".local/bin", ".bun/bin", "bin"]) out.push(path.join(home, rel, "codex"))
    return out
  },
  notFound: (checked) => new CodexBinaryNotFoundError(checked),
})
