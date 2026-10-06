/**
 * Where the GitHub Copilot CLI binary lives: `$PATH`, the system dirs, the
 * active nvm bin, then the per-user npm dirs — each probed under every
 * spelling the platform uses (`.exe`/`.cmd` on Windows). Probing itself
 * lives in `../binary-discovery.ts`.
 */

import { BinaryNotFoundError, createBinaryFinder, npmStyleBinaryCandidates } from "../binary-discovery.ts"

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
  candidates: (ctx) => npmStyleBinaryCandidates(ctx, "copilot"),
  notFound: (checked) => new CopilotBinaryNotFoundError(checked),
})
