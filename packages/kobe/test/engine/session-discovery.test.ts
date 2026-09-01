/**
 * Discovery + existence against a REAL kimi session store on disk — the
 * layout `kimi-local/history.ts` reads, written here exactly as a live kimi
 * install writes it (`session_index.jsonl` + `<dir>/agents/main/wire.jsonl`).
 *
 * Both functions exist because of one bug each:
 *   - kimi tabs never recorded an id, because kimi's CLI cannot be TOLD one
 *     and its OSC title is a sentence, so the store is the only source;
 *   - the restart check asked `readHistory(id).length > 0`, which silently
 *     means "kobe can parse this engine's messages" — kimi's reader ships no
 *     parser, so every kimi session reported as absent and its tab respawned
 *     blank under a fresh conversation.
 */

import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { discoverSessionId, engineSessionExists } from "@/engine/session-discovery"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let home: string
let worktree: string
// Restored verbatim in afterEach — including `undefined`, which the env
// object accepts as "unset" for the reader's `?.trim()` lookup.
const prevHome = process.env.KIMI_CODE_HOME as string

/** Write one kimi session for `wt`, newest-last by wire.jsonl mtime. */
async function writeSession(id: string, wt: string, mtime: Date): Promise<void> {
  const dir = path.join(home, "sessions", `wd_${id}`)
  await mkdir(path.join(dir, "agents", "main"), { recursive: true })
  const wire = path.join(dir, "agents", "main", "wire.jsonl")
  await writeFile(wire, '{"type":"whatever-kobe-does-not-parse"}\n')
  await writeFile(
    path.join(home, "session_index.jsonl"),
    `${JSON.stringify({ sessionId: id, sessionDir: dir, workDir: wt })}\n`,
    { flag: "a" },
  )
  await utimes(wire, mtime, mtime)
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "kimi-store-"))
  worktree = await mkdtemp(path.join(tmpdir(), "wt-"))
  process.env.KIMI_CODE_HOME = home
})

afterEach(() => {
  process.env.KIMI_CODE_HOME = prevHome
})

describe("discoverSessionId", () => {
  it("adopts the newest session kimi recorded for this worktree", async () => {
    await writeSession("session_old", worktree, new Date(1_000_000))
    await writeSession("session_new", worktree, new Date(2_000_000))
    expect(await discoverSessionId("kimi", worktree, new Set())).toBe("session_new")
  })

  it("gives a second tab the next session rather than the one tab 1 holds", async () => {
    await writeSession("session_old", worktree, new Date(1_000_000))
    await writeSession("session_new", worktree, new Date(2_000_000))
    expect(await discoverSessionId("kimi", worktree, new Set(["session_new"]))).toBe("session_old")
  })

  it("answers null for a worktree with no sessions, and for another worktree's", async () => {
    expect(await discoverSessionId("kimi", worktree, new Set())).toBeNull()
    await writeSession("session_elsewhere", "/some/other/worktree", new Date(1_000_000))
    expect(await discoverSessionId("kimi", worktree, new Set())).toBeNull()
  })

  it("answers null for an engine with no transcript store at all", async () => {
    await writeSession("session_new", worktree, new Date(2_000_000))
    expect(await discoverSessionId("my-custom-engine", worktree, new Set())).toBeNull()
  })
})

describe("engineSessionExists", () => {
  it("sees a kimi session that ships no message parser — the restart-blank bug", async () => {
    await writeSession("session_new", worktree, new Date(2_000_000))
    expect(await engineSessionExists("kimi", worktree, "session_new")).toBe(true)
  })

  it("is false for an id the store never recorded, and for a blank id", async () => {
    await writeSession("session_new", worktree, new Date(2_000_000))
    expect(await engineSessionExists("kimi", worktree, "session_gone")).toBe(false)
    expect(await engineSessionExists("kimi", worktree, "")).toBe(false)
  })
})
