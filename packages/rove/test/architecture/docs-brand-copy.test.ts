import { execFileSync } from "node:child_process"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
import { expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

/** `git grep` hits that may name the retired product, each with why. */
const ALLOWED_HITS: Array<(line: string) => boolean> = [
  // Lockfile integrity hashes are base64 and can spell the name by chance.
  (line) => line.startsWith("bun.lock:"),
  // Generated table rows quote publisher metadata, including external names and URLs.
  (line) => /^docs\/PLUGIN-DIRECTORY\.md:\d+:\| /.test(line),
  (line) => /^packages\/[^/]+\/CHANGELOG\.md:/.test(line),
  (line) => line.startsWith("docs/agents/dev-loop.md:") && line.includes("frozen at 0.9.64"),
  (line) =>
    line.startsWith("packages/rove-daemon/src/daemon/pre-rename-runtime.ts:") &&
    line.includes("const LEGACY_PRE_RENAME_RUNTIME_NAME ="),
]

test("the retired name appears only in history, external plugin metadata and migration references", () => {
  const retired = basename(preRenameStateDir("")).slice(1)
  const result = execFileSync("git", ["grep", "-Iin", retired], { cwd: ROOT, encoding: "utf8" })
  const unexpected = result.split("\n").filter((line) => line && !ALLOWED_HITS.some((allowed) => allowed(line)))
  expect(unexpected).toEqual([])
  const paths = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n")
  expect(paths.filter((path) => path.toLowerCase().includes(retired))).toEqual([])
})
