import { mkdtemp, open, rename, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  MAX_JSONL_LINE_CHARS,
  readFirstLineBounded,
  readTextFileBounded,
  readTextFileSyncBounded,
} from "../../src/engine/file-bounds"
import {
  ClaudeTurnDetector,
  CodexTurnDetector,
  latestClaudeCompletionMarkerFromJsonl,
} from "../../src/engine/turn-detector"

const at = "2026-01-01T00:00:00Z"
const codex = (timestamp: string) =>
  `${JSON.stringify({ type: "event_msg", timestamp, payload: { type: "task_complete" } })}\n`
const claude = (timestamp: string) =>
  `${JSON.stringify({ timestamp, message: { role: "assistant", stop_reason: "end_turn" } })}\n`
async function fixture(raw = "") {
  const dir = await mkdtemp(path.join(tmpdir(), "rove-file-boundary-"))
  const file = path.join(dir, "session.jsonl")
  await writeFile(file, raw)
  return { dir, file }
}

describe.each([
  { name: "Codex", make: () => new CodexTurnDetector(), record: codex },
  { name: "Claude", make: () => new ClaudeTurnDetector(), record: claude },
])("$name scoped transcript", ({ make, record }) => {
  it("isolates concurrent sibling sessions and invalidates same-mtime replacement", async () => {
    const f = await fixture(record(at))
    const sibling = path.join(f.dir, "sibling.jsonl")
    await writeFile(sibling, record("2026-01-01T00:00:20Z"))
    const detector = make()
    const [own, other] = await Promise.all([
      detector.latestActivityInFile(f.file),
      detector.latestActivityInFile(sibling),
    ])
    expect(own?.marker?.timestampMs).toBe(Date.parse(at))
    expect(other?.marker?.timestampMs).toBe(Date.parse("2026-01-01T00:00:20Z"))
    const before = await stat(f.file)
    await writeFile(f.file, record("2026-01-01T00:00:05Z"))
    await utimes(f.file, before.atime, before.mtime)
    expect((await detector.latestActivityInFile(f.file))?.marker?.timestampMs).toBe(Date.parse("2026-01-01T00:00:05Z"))
    const replacement = path.join(f.dir, "replacement")
    await writeFile(replacement, "{}\n")
    await utimes(replacement, before.atime, before.mtime)
    await rename(replacement, f.file)
    expect((await detector.latestActivityInFile(f.file))?.marker).toBeNull()
    await writeFile(f.file, "")
    expect((await detector.latestActivityInFile(f.file))?.marker).toBeNull()
    await rename(f.file, path.join(f.dir, "moved"))
    expect(await detector.latestActivityInFile(f.file)).toBeNull()
  })

  it("does not load a transcript above the file byte bound", async () => {
    const f = await fixture(record(at))
    const file = await open(f.file, "r+")
    await file.truncate(100 * 1024 * 1024 + 1)
    await file.close()
    const scan = await make().latestActivityInFile(f.file)
    expect(scan).toBeNull()
  })
})

it("bounds a Claude completion line before parsing", () => {
  expect(
    latestClaudeCompletionMarkerFromJsonl(
      JSON.stringify({
        message: { role: "assistant", stop_reason: "end_turn" },
        padding: "x".repeat(MAX_JSONL_LINE_CHARS),
      }),
    ),
  ).toBeNull()
})

it("reads only the first metadata line of an oversized transcript", async () => {
  const raw = '{"type":"session_meta","payload":{"cwd":"/项目"}}'
  const f = await fixture(`\n \r\n${raw}\n`)
  const file = await open(f.file, "r+")
  await file.truncate(101 * 1024 * 1024)
  await file.close()
  expect(await readFirstLineBounded(f.file)).toBe(raw)
  expect(await readTextFileBounded(f.file)).toBe("")
})

it("handles byte boundaries, multibyte content, unterminated and blank headers", async () => {
  const f = await fixture("你\nbody")
  expect(await readFirstLineBounded(f.file, 3)).toBe("你")
  expect(await readFirstLineBounded(f.file, 2)).toBe("")
  await writeFile(f.file, "你")
  expect(await readTextFileBounded(f.file, 3)).toBe("你")
  expect(readTextFileSyncBounded(f.file, 3)).toBe("你")
  expect(await readFirstLineBounded(f.file, 3)).toBe("你")
  await writeFile(f.file, " \n".repeat(20_000))
  expect(await readFirstLineBounded(f.file)).toBe("")
  await writeFile(f.file, "a".repeat(32))
  expect(await readFirstLineBounded(f.file, 32)).toBe("a".repeat(32))
  expect(await readFirstLineBounded(f.file, 31)).toBe("")
})

it("does not cache a failed scoped read after a successful stat", async () => {
  let fail = true
  let reads = 0
  const detector = new CodexTurnDetector({
    findLatestRollout: async () => null,
    statFile: async () => ({ mtimeMs: 100, size: 5, ctimeMs: 100, ino: 1, dev: 1 }),
    readFile: async () => {
      reads++
      if (fail) throw new Error("EACCES")
      return ""
    },
  })
  expect(await detector.latestActivityInFile("/scoped")).toBeNull()
  fail = false
  expect(await detector.latestActivityInFile("/scoped")).toEqual({ marker: null, mtimeMs: 100 })
  expect(reads).toBe(2)
})
