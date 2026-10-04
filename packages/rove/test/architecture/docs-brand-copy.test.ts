import { execFileSync } from "node:child_process"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
import { expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

test("the retired name appears only in history, its npm note and the temporary runtime constant", () => {
  const retired = basename(preRenameStateDir("")).slice(1)
  const result = execFileSync("git", ["grep", "-Iin", retired], { cwd: ROOT, encoding: "utf8" })
  const unexpected = result.split("\n").filter((line) => {
    if (!line) return false
    if (/^packages\/[^/]+\/CHANGELOG\.md:/.test(line)) return false
    if (line.startsWith("docs/agents/dev-loop.md:") && line.includes("frozen at 0.9.64")) return false
    return !(
      line.startsWith("packages/rove-daemon/src/daemon/pre-rename-runtime.ts:") &&
      line.includes("const LEGACY_PRE_RENAME_RUNTIME_NAME =")
    )
  })
  expect(unexpected).toEqual([])
  const paths = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n")
  expect(paths.filter((path) => path.toLowerCase().includes(retired))).toEqual([])
})
