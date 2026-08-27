/**
 * Behavior of the CI file-size gate (scripts/file-size-check.sh, run by the
 * file-size-cap job): over-cap files fail, near-cap files warn without
 * failing, files with headroom stay silent, and PR-body exemptions still
 * downgrade an over-cap file to a notice.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, test } from "vitest"

const SCRIPT = fileURLToPath(new URL("../../../../scripts/file-size-check.sh", import.meta.url))

const repo = mkdtempSync(join(tmpdir(), "file-size-check-"))
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "pipe" })

// A repo whose origin/main baseline is empty, so every file added on the
// branch counts as touched.
git("init", "-q")
writeFileSync(join(repo, "README.md"), "base\n")
git("add", ".")
git("commit", "-qm", "base")
git("update-ref", "refs/remotes/origin/main", "HEAD")

const tsFile = (name: string, lines: number) => {
  writeFileSync(join(repo, name), `${Array.from({ length: lines }, (_, i) => `// ${i}`).join("\n")}\n`)
  git("add", name)
  git("commit", "-qm", `add ${name}`)
}

const run = (prBody = "") => {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      cwd: repo,
      env: { ...process.env, BASE_REF: "main", PR_BODY: prBody },
      encoding: "utf8",
    })
    return { code: 0, stdout }
  } catch (error) {
    const e = error as { status: number; stdout: string }
    return { code: e.status, stdout: e.stdout }
  }
}

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe("file-size-check.sh", () => {
  test("a file with headroom passes silently", () => {
    tsFile("small.ts", 469)
    const { code, stdout } = run()
    expect(code).toBe(0)
    expect(stdout).not.toContain("small.ts")
  })

  test("a near-cap file warns without failing the build", () => {
    tsFile("near.ts", 471)
    const { code, stdout } = run()
    expect(code).toBe(0)
    expect(stdout).toContain("::warning file=near.ts::")
    expect(stdout).toContain("29 from the ~500 cap")
  })

  test("an over-cap file fails, and stays an error — not a warning", () => {
    tsFile("big.ts", 501)
    const { code, stdout } = run()
    expect(code).toBe(1)
    expect(stdout).toContain("::error file=big.ts::")
    expect(stdout).not.toContain("::warning file=big.ts::")
  })

  test("a PR-body exemption downgrades the over-cap error to a notice", () => {
    const { code, stdout } = run("file-size-exemption: big.ts — generated table")
    expect(code).toBe(0)
    expect(stdout).toContain("::notice file=big.ts::")
  })
})
