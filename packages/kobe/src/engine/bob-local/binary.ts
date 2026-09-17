/**
 * Where the IBM Bob Shell binary lives. The installer
 * (`curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`) fetches the
 * `bobshell` tarball and runs `npm install -g` on it, so `bob` lands in
 * whichever global npm bin dir the user's Node comes from: `$PATH` first, then
 * the system dirs, the active nvm bin, and the per-user npm dirs — each under
 * every spelling the platform uses (`.cmd` shims on Windows). Probing itself
 * lives in `../binary-discovery.ts`.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder } from "../binary-discovery.ts"

export type { BinaryDiscoveryDeps } from "../binary-discovery.ts"

export class BobBinaryNotFoundError extends BinaryNotFoundError {
  constructor(checkedPaths: readonly string[]) {
    super(
      "IBM Bob Shell binary",
      "Ensure 'bob' is on PATH (install with `curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`).",
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
