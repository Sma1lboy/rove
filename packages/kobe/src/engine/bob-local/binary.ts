/**
 * Where the IBM Bob Shell binary lives. Bob installs through its own script
 * (`curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`) but lands as
 * an ordinary npm-style bin, so the search matches its siblings: `$PATH`, the
 * system dirs, the active nvm bin, then the per-user npm dirs.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder } from "../binary-discovery.ts"

export class BobBinaryNotFoundError extends BinaryNotFoundError {
  constructor(checkedPaths: readonly string[]) {
    super(
      "IBM Bob Shell binary",
      "Ensure 'bob' is on PATH (for example `curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`).",
      checkedPaths,
    )
    this.name = "BobBinaryNotFoundError"
  }
}

export const findBobBinary = createBinaryFinder({
  name: "bob",
  candidates({ deps, home }) {
    const win32 = (deps.platform?.() ?? process.platform) === "win32"
    const names = win32 ? ["bob.exe", "bob.cmd", "bob"] : ["bob"]

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
  notFound: (checked) => new BobBinaryNotFoundError(checked),
})
