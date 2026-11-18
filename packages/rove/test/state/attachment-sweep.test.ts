import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { normalizeKeepDays, sweepAttachments } from "../../src/state/attachment-sweep"

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

test("only Rove's own files past the keep time go, and never one something still names", () => {
  const dir = dirWith({
    "attach-old.png": 40,
    "attach-old-named.png": 40,
    "attach-recent.png": 5,
    "notes.txt": 400,
  })
  const references = '{"prompt":"look\\n\\nimages[0]: /home/.rove/attachments/attach-old-named.png"}'
  expect(sweepAttachments({ dir, keepDays: 30, now: NOW, references })).toEqual(["attach-old.png"])
  expect(readdirSync(dir).sort()).toEqual(["attach-old-named.png", "attach-recent.png", "notes.txt"])
})

test("keepDays 0 deletes nothing; a value that is not a whole number of days means the default", () => {
  const dir = dirWith({ "attach-old.png": 400 })
  expect(sweepAttachments({ dir, keepDays: 0, now: NOW, references: "" })).toEqual([])
  expect([normalizeKeepDays(undefined), normalizeKeepDays("7"), normalizeKeepDays(-1), normalizeKeepDays(0)]).toEqual([
    30, 7, 30, 0,
  ])
})
