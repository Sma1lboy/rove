/**
 * Where the IBM Bob Shell binary lives. Bob installs through its own script
 * (`curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`) but lands as
 * an ordinary npm-style bin, so the search matches its siblings: `$PATH`, the
 * system dirs, the active nvm bin, then the per-user npm dirs.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder, npmStyleDirs } from "../binary-discovery.ts"

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

    return npmStyleDirs({ deps, home }).flatMap((dir) => names.map((name) => path.join(dir, name)))
  },
  notFound: (checked) => new BobBinaryNotFoundError(checked),
})
