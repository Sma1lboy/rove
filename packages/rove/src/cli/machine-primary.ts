/**
 * `rove machine primary [<path>] [--clear]`: which of this machine's checkouts a repo id
 * resolves to when it has several (`repo-match`, `add --repo owner/name`, a hub's dispatch).
 * With no path, lists the marks.
 */

import { resolve } from "node:path"
import { repoIdentity } from "../machines/repo-identity.ts"
import { primaryCheckouts, repoIdOf, setPrimaryCheckout } from "../machines/repo-ref.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"
import { argvHasFlag } from "./argv.ts"

export function machinePrimary(argv: readonly string[], fail: (message: string) => never): void {
  const clear = argvHasFlag(argv, "--clear")
  const target = argv.find((a) => !a.startsWith("--"))
  if (!target) {
    const marks = Object.entries(primaryCheckouts())
    if (marks.length === 0) process.stdout.write("No primary checkouts marked.\n")
    for (const [id, path] of marks) process.stdout.write(`${id}  ${path}\n`)
    return
  }
  const path = resolve(target)
  const id = repoIdOf(repoIdentity(path))
  if (!id) fail(`primary: ${path} is not a git checkout`)
  setPrimaryCheckout(id, clear ? null : path)
  process.stdout.write(
    clear
      ? `${ROVE_PRODUCT_NAME} machine: ${id} has no primary checkout now\n`
      : `${ROVE_PRODUCT_NAME} machine: ${id} resolves to ${path} here\n`,
  )
}
