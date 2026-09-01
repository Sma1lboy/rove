/**
 * Behavior of the CI silent-catch gate (scripts/no-silent-catch.mjs, run by
 * the quality job): a bare `console.error` catch handler fails, the same
 * handler paired with an on-screen notify passes, and the
 * `silent-catch-ok` marker exempts a deliberate case.
 *
 * The gate exists because this defect class has been fixed instance-by-
 * instance several times; without it, the next `.catch(console.error)` lands
 * unchallenged.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, expect, test } from "vitest"

const SCRIPT = fileURLToPath(new URL("../../../../scripts/no-silent-catch.mjs", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "no-silent-catch-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Write `source` as the only file in a fresh scan root and run the gate. */
function run(source: string): { code: number; stdout: string } {
  const root = mkdtempSync(join(dir, "root-"))
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "probe.tsx"), source)
  try {
    return { code: 0, stdout: execFileSync("node", [SCRIPT, root], { encoding: "utf8" }) }
  } catch (error) {
    const e = error as { status: number; stdout: string }
    return { code: e.status, stdout: e.stdout }
  }
}

test("an arrow-form bare console.error catch fails the gate", () => {
  const result = run(`export function go(p: { run: () => Promise<void> }) {
  void p.run().catch((err) => console.error("[rove] run failed:", err))
}
`)
  expect(result.code).toBe(1)
  expect(result.stdout).toContain("bare console.error in a catch handler")
})

test("a block-form catch whose only statement is the log fails the gate", () => {
  const result = run(`export async function go(run: () => Promise<void>) {
  try {
    await run()
  } catch (err) {
    console.error("[rove] run failed:", err)
  }
}
`)
  expect(result.code).toBe(1)
  expect(result.stdout).toContain("bare console.error in a catch handler")
})

test("a promise .catch with a block body whose only statement is the log fails the gate", () => {
  // The try/catch-keyword pattern misses this: `.catch((err) => {` is a
  // method call, not the `catch` keyword. Opening a brace to hold one log
  // line is the most natural way to write the defect.
  const result = run(`export function go(p: { run: () => Promise<void> }) {
  void p.run().catch((err) => {
    console.error("[rove] run failed:", err)
  })
}
`)
  expect(result.code).toBe(1)
  expect(result.stdout).toContain("bare console.error in a catch handler")
})

test("a bare `.catch(console.error)` fails the gate", () => {
  const result = run(`export function go(p: { run: () => Promise<void> }) {
  void p.run().catch(console.error)
}
`)
  expect(result.code).toBe(1)
  expect(result.stdout).toContain("bare console.error in a catch handler")
})

test("a block-body .catch that also notifies passes", () => {
  const result = run(`export function go(p: { run: () => Promise<void> }, notifyError: (m: string) => void) {
  void p.run().catch((err) => {
    console.error("[rove] run failed:", err)
    notifyError("Couldn't run it")
  })
}
`)
  expect(result.code).toBe(0)
})

test("a silent-catch-ok marker on the line ABOVE exempts a block-body catch", () => {
  // The repo's live exemptions (use-workspace-selection.ts) are written in
  // this position, so the block-body shape has to honour it too — otherwise
  // adding the shape turns legitimate code red.
  const result = run(`export function go(p: { run: () => Promise<void> }) {
  // silent-catch-ok: focus bookkeeping, nothing for the user to act on.
  void p.run().catch((err) => {
    console.error("[rove] run failed:", err)
  })
}
`)
  expect(result.code).toBe(0)
})

test("logging AND notifying passes — that shape is the fix, not the defect", () => {
  const result = run(`export async function go(run: () => Promise<void>, notifyError: (m: string) => void) {
  try {
    await run()
  } catch (err) {
    console.error("[rove] run failed:", err)
    notifyError("Couldn't run it")
  }
}
`)
  expect(result.code).toBe(0)
})

test("a silent-catch-ok marker exempts a deliberate case", () => {
  const result = run(`export function go(p: { run: () => Promise<void> }) {
  // silent-catch-ok: telemetry only, nothing for the user to act on.
  void p.run().catch((err) => console.error("[rove] run failed:", err))
}
`)
  expect(result.code).toBe(0)
})

test("a clean tree passes", () => {
  const result = run(`export function go(p: { run: () => Promise<void> }, notifyError: (m: string) => void) {
  void p.run().catch((err) => notifyError(String(err)))
}
`)
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("no-silent-catch OK")
})
