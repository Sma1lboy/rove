import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { normalizeKeepDays, startAttachmentSweep, sweepAttachments } from "../../src/state/attachment-sweep"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 17)

function dirWith(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), "attach-sweep-"))
  for (const [name, ageDays] of Object.entries(files)) {
    writeFileSync(join(dir, name), "x")
    const at = (NOW - ageDays * DAY_MS) / 1000
    utimesSync(join(dir, name), at, at)
  }
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
})

test("an attachment a start scheduled for later still names survives the daemon's sweep", () => {
  const home = mkdtempSync(join(tmpdir(), "attach-sweep-home-"))
  vi.stubEnv("ROVE_HOME_DIR", home)
  const state = join(home, ".rove")
  const dir = join(state, "attachments")
  mkdirSync(dir, { recursive: true })
  const old = (Date.now() - 40 * DAY_MS) / 1000
  for (const name of ["attach-later.png", "attach-orphan.png"]) {
    writeFileSync(join(dir, name), "x")
    utimesSync(join(dir, name), old, old)
  }
  const prompt = `fix this\n\nimages[0]: ${join(dir, "attach-later.png")}`
  writeFileSync(join(state, "pending-starts.json"), JSON.stringify({ version: 1, starts: [{ id: "s1", prompt }] }))
  startAttachmentSweep()()
  expect(readdirSync(dir)).toEqual(["attach-later.png"])
})

test("only Rove's own files past the keep time go, and never one something still names", () => {
  const dir = dirWith({
    "attach-old.png": 40,
    "attach-old-named.png": 40,
    "attach-recent.png": 5,
    "paste-20261001-ab12cd34.png": 40,
    "notes.txt": 400,
  })
  const references = '{"prompt":"look\\n\\nimages[0]: /home/.rove/attachments/attach-old-named.png"}'
  expect(sweepAttachments({ dir, keepDays: 30, now: NOW, references }).sort()).toEqual([
    "attach-old.png",
    "paste-20261001-ab12cd34.png",
  ])
  expect(readdirSync(dir).sort()).toEqual(["attach-old-named.png", "attach-recent.png", "notes.txt"])
})

test("keepDays 0 deletes nothing; a value that is not a whole number of days means the default", () => {
  const dir = dirWith({ "attach-old.png": 400 })
  expect(sweepAttachments({ dir, keepDays: 0, now: NOW, references: "" })).toEqual([])
  expect([normalizeKeepDays(undefined), normalizeKeepDays("7"), normalizeKeepDays(-1), normalizeKeepDays(0)]).toEqual([
    30, 7, 30, 0,
  ])
})
