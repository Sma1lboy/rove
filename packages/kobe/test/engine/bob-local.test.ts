/**
 * Bob Shell's adapter, against a fixture database built to the schema measured
 * on bob 2.0.5. The three cases that carry weight are the ones where Bob's
 * schema contradicts its own column names: an empty `tasks.directory`, a
 * `tool` row whose `id` is not the call it answers, and a `content` that is a
 * string rather than a block array.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { detectBobAccount } from "../../src/engine/account-detect.ts"
import { bobHistoryReaderFor } from "../../src/engine/bob-local/history.ts"
import { trustBobWorktree } from "../../src/engine/bob-local/trust.ts"
import { engineEntry } from "../../src/engine/registry.ts"
import { bobDbPath, bobTrustPath } from "../../src/engine/vendor-home.ts"

const WORKTREE = "/tmp/wt/alpha"
const OTHER = "/tmp/wt/beta"

function seed(home: string): void {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
  const { mkdirSync } = require("node:fs") as typeof import("node:fs")
  mkdirSync(join(home, ".bob", "db"), { recursive: true })
  const db = new DatabaseSync(bobDbPath(home))
  db.exec(`CREATE TABLE tasks (id TEXT, directory TEXT, env TEXT, costs TEXT, created_at INT, updated_at INT);
           CREATE TABLE messages (id TEXT, task_id TEXT, role TEXT, data TEXT, created_at INT)`)
  const task = (id: string, ws: string, created: number, updated: number, costs: string | null) =>
    db
      .prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?)")
      // `directory` is NULL exactly as bob 2.0.5 leaves it.
      .run(id, null, JSON.stringify({ workspace: ws }), costs, created, updated)
  task("t-old", WORKTREE, 100, 200, null)
  task(
    "t-new",
    WORKTREE,
    300,
    400,
    JSON.stringify({ input: 1200, output: 34, cacheRead: 900, cacheWrite: 300, contextTokens: 5000, cost: 0.12 }),
  )
  task("t-other", OTHER, 500, 600, null)

  let n = 0
  const msg = (taskId: string, role: string, data: unknown) =>
    db.prepare("INSERT INTO messages VALUES (?,?,?,?,?)").run(`m${n}`, taskId, role, JSON.stringify(data), ++n)
  msg("t-new", "system", { role: "system", content: "ROLE DEFINITION".repeat(100) })
  msg("t-new", "user", { role: "user", content: "list the files" })
  msg("t-new", "assistant", {
    role: "assistant",
    content: "on it",
    toolCalls: [{ id: "tooluse_AAA", name: "Bash", arguments: { command: "ls" } }],
  })
  // Its `id` is the MESSAGE id, not `tooluse_AAA` — pairing must be positional.
  msg("t-new", "tool", { role: "tool", id: "9f3c1d", content: "README.md", toolUsage: { signature: "Bash" } })
  msg("t-new", "assistant", { role: "assistant", content: "one file" })
  db.close()
}

describe("bob history reader", () => {
  const home = mkdtempSync(join(tmpdir(), "bob-home-"))
  beforeAll(() => seed(home))
  const reader = () => bobHistoryReaderFor(home)

  // `tasks.directory` is empty on every real row; the path lives in env.workspace.
  it("finds a worktree's sessions through env.workspace, oldest first", async () => {
    expect(await reader().listSessionIdsForWorktree(WORKTREE)).toEqual(["t-old", "t-new"])
    expect(await reader().listSessionIdsForWorktree("/tmp/wt/nope")).toEqual([])
  })

  it("drops Bob's system prompt and keeps the conversation", async () => {
    const msgs = await reader().readHistory("t-new")
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"])
    expect(msgs[0]?.blocks).toEqual([{ type: "text", text: "list the files" }])
  })

  it("pairs a tool result with the call it answers, positionally", async () => {
    const blocks = (await reader().readHistory("t-new")).flatMap((m) => m.blocks)
    const call = blocks.find((b) => b.type === "tool_call")
    const result = blocks.find((b) => b.type === "tool_result")
    expect(call).toMatchObject({ name: "Bash", callId: "tooluse_AAA" })
    expect(result).toMatchObject({ callId: "tooluse_AAA", output: "README.md", isError: false })
  })

  it("reports session tokens from the cost record, and nothing when absent", async () => {
    expect(await reader().readUsageSnapshot?.("t-new")).toEqual({
      input_tokens: 1200,
      output_tokens: 34,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 300,
      context_tokens: 5000,
    })
    expect(await reader().readUsageSnapshot?.("t-old")).toBeUndefined()
  })

  // One database, no per-session file: a null here is the honest answer, and
  // it is what stops `readTurns` being handed a path that cannot exist.
  it("has no transcript path to hand another agent", async () => {
    expect(await reader().transcriptPath("t-new", WORKTREE)).toBeNull()
    expect(await reader().latestTranscriptMtimeForWorktree(WORKTREE)).toBe(400)
  })

  it("reads a missing install as empty rather than throwing", async () => {
    const empty = bobHistoryReaderFor(mkdtempSync(join(tmpdir(), "bob-none-")))
    expect(await empty.listSessionIdsForWorktree(WORKTREE)).toEqual([])
    expect(await empty.readHistory("t-new")).toEqual([])
    expect(await empty.latestTranscriptMtimeForWorktree(WORKTREE)).toBe(0)
  })
})

describe("bob worktree trust", () => {
  it("writes Bob's own record, merges, and survives a corrupt file", () => {
    const home = mkdtempSync(join(tmpdir(), "bob-trust-"))
    const path = bobTrustPath(home)
    trustBobWorktree("/tmp/wt-a", home)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 1, folders: { "/tmp/wt-a": "TRUST_FOLDER" } })
    trustBobWorktree("/tmp/wt-a", home) // idempotent
    trustBobWorktree("/tmp/wt-b", home)
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")).folders)).toEqual(["/tmp/wt-a", "/tmp/wt-b"])
    writeFileSync(path, "{ not json")
    trustBobWorktree("/tmp/wt-c", home)
    expect(JSON.parse(readFileSync(path, "utf8")).folders).toEqual({ "/tmp/wt-c": "TRUST_FOLDER" })
  })
})

describe("bob account detection", () => {
  const deps = (files: Record<string, string>) => ({
    readFile: (p: string) => files[p] ?? null,
    env: () => undefined,
    home: () => "/home/u",
    findBobBinary: async () => "/usr/local/bin/bob",
    findClaudeBinary: async () => "",
    findCodexBinary: async () => "",
    findCopilotBinary: async () => "",
    findKimiBinary: async () => "",
    findPiBinary: async () => "",
    findOmpBinary: async () => "",
  })
  const secrets = "/home/u/.bob/settings/auth-secrets.json"

  // The key carries the API host, which differs per region — hence the prefix.
  it("reads a regional token key as signed in", async () => {
    const raw = JSON.stringify({
      "bob.auth.tokens-https://api.eu-de.bob.ibm.com": "opaque",
      "bob.telemetry.sessionId": "x",
    })
    expect((await detectBobAccount(deps({ [secrets]: raw }))).account).toEqual({ kind: "signed-in" })
  })

  it("reads telemetry-only or missing state as signed out", async () => {
    expect((await detectBobAccount(deps({ [secrets]: '{"bob.telemetry.sessionId":"x"}' }))).account).toEqual({
      kind: "none",
    })
    expect((await detectBobAccount(deps({}))).account).toEqual({ kind: "none" })
  })

  it("reports a corrupt store as an error, not as signed out silently", async () => {
    const status = await detectBobAccount(deps({ [secrets]: "{ not json" }))
    expect(status.account).toEqual({ kind: "none" })
    expect(status.accountError).toContain("parse")
  })
})

describe("bob launch contract", () => {
  // These two are the whole reason a parallel round works: bare `bob` prints
  // help, a fresh worktree stops the TUI on a trust dialog nobody can answer,
  // and `bob chat` DISCARDS a positional prompt without erroring — an argv
  // first message would leave every sibling sitting at an empty composer.
  it("launches the TUI already trusting the worktree, and pastes the first message", () => {
    const bob = engineEntry("bob")
    expect(bob.defaultCommand).toEqual(["bob", "chat", "--trust"])
    expect(bob.firstMessageDelivery).toBe("paste")
  })
})
