/**
 * Where the GitHub Copilot CLI binary lives: `$PATH`, the system dirs, the
 * active nvm bin, then the per-user npm dirs — each probed under every
 * spelling the platform uses (`.exe`/`.cmd` on Windows). Probing itself
 * lives in `../binary-discovery.ts`.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder, npmStyleDirs } from "../binary-discovery.ts"

export type { BinaryDiscoveryDeps } from "../binary-discovery.ts"

export class CopilotBinaryNotFoundError extends BinaryNotFoundError {
  constructor(checkedPaths: readonly string[]) {
    super(
      "GitHub Copilot CLI binary",
      "Ensure 'copilot' is on PATH (for example `npm install -g @github/copilot` or `brew install copilot-cli`).",
      checkedPaths,
    )
    this.name = "CopilotBinaryNotFoundError"
  }
}

export const findCopilotBinary = createBinaryFinder({
  name: "copilot",
  candidates({ deps, home }) {
    const win32 = (deps.platform?.() ?? process.platform) === "win32"
    const names = win32 ? ["copilot.exe", "copilot.cmd", "copilot"] : ["copilot"]

    return npmStyleDirs({ deps, home }).flatMap((dir) => names.map((name) => path.join(dir, name)))
  },
  notFound: (checked) => new CopilotBinaryNotFoundError(checked),
})
