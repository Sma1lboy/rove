/**
 * Where the GitHub Copilot CLI binary lives: `$PATH`, the system dirs, the
 * active nvm bin, then the per-user npm dirs — each probed under every
 * spelling the platform uses (`.exe`/`.cmd` on Windows). Probing itself
 * lives in `../binary-discovery.ts`.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder } from "../binary-discovery.ts"

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

    const dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
    const nvmBin = deps.env("NVM_BIN")
    if (nvmBin) dirs.push(nvmBin)

    const homeDirs = [
      path.join(home, ".npm-global/bin"),
      path.join(home, ".local/bin"),
      path.join(home, ".bun/bin"),
      path.join(home, "bin"),
    ]
    if (win32) {
      const appData = deps.env("APPDATA")
      const localAppData = deps.env("LOCALAPPDATA")
      homeDirs.unshift(path.join(home, "AppData/Roaming/npm"))
      if (appData) homeDirs.unshift(path.join(appData, "npm"))
      if (localAppData) homeDirs.unshift(path.join(localAppData, "npm"))
    }

    return [...dirs, ...homeDirs].flatMap((dir) => names.map((name) => path.join(dir, name)))
  },
  notFound: (checked) => new CopilotBinaryNotFoundError(checked),
})
