/**
 * Where the IBM Bob Shell binary lives. Bob installs through its own script
 * (`curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`) but lands as
 * an ordinary npm-style bin, so the search matches its siblings: `$PATH`, the
 * system dirs, the active nvm bin, then the per-user npm dirs.
 */

import { BinaryNotFoundError, createBinaryFinder, npmStyleBinaryCandidates } from "../binary-discovery.ts"

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
  candidates: (ctx) => npmStyleBinaryCandidates(ctx, "bob"),
  notFound: (checked) => new BobBinaryNotFoundError(checked),
})
