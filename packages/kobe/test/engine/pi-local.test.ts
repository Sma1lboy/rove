/**
 * The pi family's three detection surfaces, each pinned against what the
 * installed binaries actually wrote (2026-09-11):
 *
 *  - the OSC title (`π ⠋ label` working, `π > label` resting, `π ! label`
 *    blocked at an approval prompt),
 *  - the screen states captured at those same moments,
 *  - the session store layout, including the two directory encodings.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

// `os.homedir()` reads the SYSTEM account on macOS, not $HOME, so the
// default-deps test below needs the module mocked the way
// `history-default-deps.test.ts` does it. Injected-deps tests are unaffected.
const tmpHome = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs")
  const { tmpdir: td } = require("node:os")
  const { join: j } = require("node:path")
  return mk(j(td(), "rove-pi-home-"))
})

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>()
  return { ...actual, homedir: () => tmpHome, default: { ...actual, homedir: () => tmpHome } }
})

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true })
})
import { parsePiSessionJsonl } from "../../src/engine/pi-local/history-parse.ts"
import {
  type PiHistoryDeps,
  latestTranscriptMtimeForWorktree,
  listSessionIdsForWorktree,
  readHistory,
  sessionDirNamesForWorktree,
  sessionIdFromFileName,
  transcriptPath,
} from "../../src/engine/pi-local/history.ts"
import { OMP_SCREEN_MANIFEST, PI_SCREEN_MANIFEST } from "../../src/engine/pi-local/screen.ts"
import { sniffProtocolFromTitle } from "../../src/engine/protocol-sniff.ts"
import { engineTitleTurnHint, stripEngineStatusPrefix } from "../../src/engine/registry.ts"
import { classifyScreen } from "../../src/engine/screen-state.ts"

describe("pi-family terminal titles", () => {
  it("reads omp's run-state separator", () => {
    expect(engineTitleTurnHint("omp", "π ⠋ Fix the sidebar")).toBe("working")
    expect(engineTitleTurnHint("omp", "π ⠏ Fix the sidebar")).toBe("working")
    expect(engineTitleTurnHint("omp", "π > Fix the sidebar")).toBe("rest")
    // Blocked on a human is NEITHER: an approval prompt does not end the turn,
    // and the interrupt observer must not read it as an escape.
    expect(engineTitleTurnHint("omp", "π ! Fix the sidebar")).toBeNull()
  })

  it("strips the brand and the state so the tab is named after the session", () => {
    expect(stripEngineStatusPrefix("π ⠋ Fix the sidebar", "omp")).toBe("Fix the sidebar")
    expect(stripEngineStatusPrefix("π > Fix the sidebar", "omp")).toBe("Fix the sidebar")
    expect(stripEngineStatusPrefix("π - Fix the sidebar - kobe", "pi")).toBe("Fix the sidebar - kobe")
  })

  it("claims no turn state for pi, whose title carries none", () => {
    expect(engineTitleTurnHint("pi", "π - work")).toBeNull()
  })

  it("gives the protocol sniffer one unambiguous glyph per family id", () => {
    expect(sniffProtocolFromTitle("π ⠋ Fix the sidebar")).toBe("omp")
    expect(sniffProtocolFromTitle("π > Fix the sidebar")).toBe("omp")
    expect(sniffProtocolFromTitle("π - Fix the sidebar - kobe")).toBe("pi")
  })
})

describe("pi-family screen manifests", () => {
  it("classifies omp's approval prompt as blocked, and its rest footer as idle", () => {
    // Captured at a real `Allow tool: bash` prompt (omp 18.1.17).
    const blocked = [
      "  󱊷 Running echo command",
      "╭─ Allow tool: bash ──────────────╮",
      "│ Command: echo hello              │",
      "│  ❯ Approve                       │",
      "│    Deny                          │",
      " ⠏ 28s · DeepSeek V4.1 Flash · work ·",
    ].join("\n")
    expect(classifyScreen(OMP_SCREEN_MANIFEST, blocked)).toBe("blocked")

    const working = ["❯ ", "⠦ 10s · DeepSeek V4.1 Flash · rove-probe/work ·"].join("\n")
    expect(classifyScreen(OMP_SCREEN_MANIFEST, working)).toBe("working")

    const idle = ["❯ ", " · 󰪣 DeepSeek V4.1 Flash ·  rove-probe/work ·"].join("\n")
    expect(classifyScreen(OMP_SCREEN_MANIFEST, idle)).toBe("idle")
  })

  it("classifies pi's trust gate as blocked and a running turn as working", () => {
    const trust = [
      " Trust project folder?",
      " /private/tmp/rove-probe/trust",
      " → Trust",
      "   Do not trust",
      " ↑↓ navigate  enter select  escape/ctrl+c cancel",
    ].join("\n")
    expect(classifyScreen(PI_SCREEN_MANIFEST, trust)).toBe("blocked")

    expect(classifyScreen(PI_SCREEN_MANIFEST, " ⠴ Working...")).toBe("working")
    expect(classifyScreen(PI_SCREEN_MANIFEST, "/private/tmp/work (main)\n↑8.8k ↓40 R8.6k 3.4%/256k (auto)")).toBe(
      "idle",
    )
  })

  it("answers null rather than guessing on an unknown screen", () => {
    expect(classifyScreen(PI_SCREEN_MANIFEST, "hello from a plain shell")).toBeNull()
  })
})

describe("pi-family session store", () => {
  const deps: PiHistoryDeps = {
    home: () => "/Users/me",
    env: () => undefined,
    tmpdir: () => "/private/tmp",
    realpath: (p) => p,
    readdir: async () => [],
    stat: async () => null,
    readFile: async () => null,
  }

  it("derives pi's absolute session directory", () => {
    expect(sessionDirNamesForWorktree("pi", "/Users/me/i/kobe", deps)).toEqual(["--Users-me-i-kobe--"])
  })

  it("derives omp's home-, temp- and absolute-form directories", () => {
    // omp writes the home-relative form for a cwd under $HOME …
    expect(sessionDirNamesForWorktree("omp", "/Users/me/i/kobe", deps)).toEqual(["-i-kobe", "--Users-me-i-kobe--"])
    // … the temp-relative form under the (canonicalized) temp root …
    expect(sessionDirNamesForWorktree("omp", "/private/tmp/x", deps)).toEqual(["-tmp-x", "--private-tmp-x--"])
    // … and the absolute form for anything else, which is also what its own
    // older versions wrote for every path.
    expect(sessionDirNamesForWorktree("omp", "/opt/src", deps)).toEqual(["--opt-src--"])
  })

  it("reads the session id off the <timestamp>_<uuid>.jsonl name", () => {
    expect(sessionIdFromFileName("2026-09-11T04-18-04-066Z_01a08eaf-d8a2-7000-ab94-23faf1c1d1c2.jsonl")).toBe(
      "01a08eaf-d8a2-7000-ab94-23faf1c1d1c2",
    )
    expect(sessionIdFromFileName("notes.txt")).toBeNull()
  })

  it("lists a worktree's sessions oldest-first and mtime-reads the newest", async () => {
    const files: Record<string, string[]> = {
      "--Users-me-i-kobe--": ["2026-01-02_b.jsonl", "2026-01-01_a.jsonl"],
    }
    const withFiles: PiHistoryDeps = {
      ...deps,
      // Basename, never a "/"-split: the injected deps still build their paths
      // with `path.join`, which is a backslash on Windows — and this suite runs
      // there too (the split version answered `[]` under the Windows job).
      readdir: async (dir) => (basename(dir) === "sessions" ? ["--Users-me-i-kobe--"] : (files[basename(dir)] ?? [])),
      stat: async (file) => ({ mtimeMs: file.endsWith("2026-01-02_b.jsonl") ? 200 : 100, isFile: true }),
    }
    expect(await listSessionIdsForWorktree("pi", "/Users/me/i/kobe", withFiles)).toEqual(["a", "b"])
    expect(await latestTranscriptMtimeForWorktree("pi", "/Users/me/i/kobe", withFiles)).toBe(200)
    expect(await transcriptPath("pi", "b", "/Users/me/i/kobe", withFiles)).toContain("2026-01-02_b.jsonl")
  })

  it("returns no history rather than throwing when the store is absent", async () => {
    expect(await readHistory("omp", "nope", deps)).toEqual([])
  })
})

describe("pi-family session parsing", () => {
  it("folds messages, tool calls and thinking into neutral blocks", () => {
    const raw = [
      JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      }),
      JSON.stringify({
        type: "message",
        id: "m2",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
          ],
          timestamp: 2,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "m3",
        timestamp: "2026-01-01T00:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "t1",
          toolName: "bash",
          content: "ok",
          isError: false,
          timestamp: 3,
        },
      }),
      // Extension state, not conversation.
      JSON.stringify({ type: "custom", customType: "rove", data: {} }),
    ].join("\n")

    const messages = parsePiSessionJsonl(raw, "s1")
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"])
    expect(messages[1]?.blocks).toEqual([
      { type: "thinking", text: "hmm" },
      { type: "tool_call", callId: "t1", name: "bash", input: { command: "ls" } },
    ])
    expect(messages[2]?.blocks).toEqual([{ type: "tool_result", callId: "t1", output: "ok", isError: false }])
    expect(messages[0]?.sessionId).toBe("s1")
  })

  it("keeps a torn append out of the transcript instead of dropping the file", () => {
    const raw = [
      JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: "one" },
      }),
      '{"type":"message","id":"m2","message":{"role":"assistant"',
    ].join("\n")
    const messages = parsePiSessionJsonl(raw, "s1")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.blocks).toEqual([{ type: "text", text: "one" }])
  })
})

/**
 * The default-deps path: real `$HOME` resolution and the REAL session
 * directory encoding for both CLIs, against a temp agent dir. The injected
 * suite above would stay green if `vendorAgentDir` read the wrong env var or
 * the encoder dropped a separator, so this drives the shipped defaults with
 * an actual file on disk.
 */
describe("pi-family session store, default deps", () => {
  it("finds an omp session from the home-relative directory omp writes", async () => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR
    try {
      const agentDir = join(tmpHome, ".omp", "agent")
      const sessionDir = join(agentDir, "sessions", "-i-kobe")
      mkdirSync(sessionDir, { recursive: true })
      const file = join(sessionDir, "2026-01-01T00-00-00-000Z_aaaa-bbbb.jsonl")
      writeFileSync(
        file,
        `${JSON.stringify({ type: "message", id: "m1", timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content: "hi" } })}\n`,
      )
      process.env.PI_CODING_AGENT_DIR = agentDir

      // The worktree must EXIST: both CLIs encode the RESOLVED path, and on
      // macOS an unresolved `/var/…` never matches the `/private/var/…` the
      // store was written under.
      const worktree = join(tmpHome, "i", "kobe")
      mkdirSync(worktree, { recursive: true })
      expect(await listSessionIdsForWorktree("omp", worktree)).toEqual(["aaaa-bbbb"])
      expect(await transcriptPath("omp", "aaaa-bbbb", worktree)).toBe(file)
      expect(await latestTranscriptMtimeForWorktree("omp", worktree)).toBeGreaterThan(0)
      // Resolving the file is half the point; the other half is that the
      // shipped parser turns its one record into a neutral message.
      expect((await readHistory("omp", "aaaa-bbbb"))[0]?.blocks).toEqual([{ type: "text", text: "hi" }])
    } finally {
      if (previousAgentDir === undefined) Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR")
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    }
  })
})
