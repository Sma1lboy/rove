/**
 * Where the Kimi Code CLI binary lives. The installer puts the launcher at
 * `~/.kimi-code/bin/kimi` and users may also symlink it onto PATH — so probe
 * `which` first, then the install dir, then the usual bin directories.
 * Probing itself lives in `../binary-discovery.ts`.
 */

import path from "node:path"
import { BinaryNotFoundError, createBinaryFinder } from "../binary-discovery.ts"

export type { BinaryDiscoveryDeps } from "../binary-discovery.ts"

export class KimiBinaryNotFoundError extends BinaryNotFoundError {
  constructor(checkedPaths: readonly string[]) {
    super("Kimi Code CLI binary", "Ensure 'kimi' is on PATH or installed at ~/.kimi-code/bin/kimi.", checkedPaths)
    this.name = "KimiBinaryNotFoundError"
  }
}

export const findKimiBinary = createBinaryFinder({
  name: "kimi",
  candidates: ({ home }) =>
    [
      path.join(home, ".kimi-code/bin"),
      path.join(home, ".local/bin"),
      path.join(home, "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ].map((dir) => path.join(dir, "kimi")),
  notFound: (checked) => new KimiBinaryNotFoundError(checked),
})
