/**
 * Generic ACP (`agent-client-protocol`) engine adapter tests:
 *  - JSON-RPC 2.0 client handshake, session lifecycle, streaming updates, permission handling, cancellation
 *  - Neutral Message / ContentBlock and EngineActivityKind normalization
 *  - ACP JSONL transcript store (`EngineHistoryReader`) and `AcpTurnDetector`
 *  - Registry / preset / plugin wiring and `_acp-bridge` argv construction
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import {
  ACP_ENGINE_ENTRY,
  ACP_PROTOCOL,
  ensureAcpBridgeWrapped,
  insertAcpBridgeFlags,
} from "@sma1lboy/rove-core/engine/acp-local/adapter.ts"
import { parseAcpBridgeArgs, pickAutoApproveOption } from "@sma1lboy/rove-core/engine/acp-local/bridge-runner.ts"
import { AcpClient } from "@sma1lboy/rove-core/engine/acp-local/client.ts"
import {
  AcpTurnDetector,
  acpHistoryReaderFor,
  appendAcpTranscriptRecord,
} from "@sma1lboy/rove-core/engine/acp-local/history.ts"
import {
  activityFromAcpStopReason,
  activityFromAcpUpdate,
  latestAcpCompletionMarkerFromJsonl,
  normalizeAcpRecords,
  parseAcpJsonl,
} from "@sma1lboy/rove-core/engine/acp-local/normalize.ts"
import { clearPluginEngines, isContribEngine } from "@sma1lboy/rove-core/engine/contrib-engines.ts"
import {
  ENGINE_PROTOCOLS,
  engineLaunchArgv,
  engineResumeArgv,
  resolveCommandProtocol,
} from "@sma1lboy/rove-core/engine/engine-presets.ts"
import { foregroundEngineIn } from "@sma1lboy/rove-core/engine/foreground.ts"
import { loadPluginEngines } from "@sma1lboy/rove-core/engine/plugin-engines.ts"
import { engineEntry, supportsStructuredHistory } from "@sma1lboy/rove-core/engine/registry.ts"
import { buildEngineSessionLaunch } from "@sma1lboy/rove-core/engine/session-launch.ts"
import { parsePluginManifest } from "@sma1lboy/rove-daemon/plugins/manifest"
import { savePluginRegistry } from "@sma1lboy/rove-daemon/plugins/registry"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let home: string
let originalHome: string | undefined

function writeState(state: Record<string, unknown>): void {
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf8")
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rove-acp-"))
  originalHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = home
  writeState({})
})

afterEach(() => {
  clearPluginEngines()
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: restore truly unset env var
    delete process.env.ROVE_HOME_DIR
  } else process.env.ROVE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe("ACP normalizer", () => {
  it("coalesces text and thinking chunks and pairs tool calls with terminal results", () => {
    const records = parseAcpJsonl(
      [
        JSON.stringify({ type: "session_meta", sessionId: "s-1", cwd: "/repo", timestamp: "2026-11-28T00:00:00Z" }),
        JSON.stringify({ type: "user_message", text: "Fix tests", timestamp: "2026-11-28T00:00:01Z" }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:02Z",
          update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking " } },
        }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:02Z",
          update: { sessionUpdate: "agent_thought_chunk", content: "files" },
        }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:03Z",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tc-1",
            name: "read_file",
            rawInput: { path: "src/app.ts" },
            status: "pending",
          },
        }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:04Z",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc-1",
            status: "completed",
            rawOutput: "export const ok = true",
          },
        }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:05Z",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "All " } },
        }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:05Z",
          update: { sessionUpdate: "agent_message_chunk", content: "done." },
        }),
        JSON.stringify({ type: "turn_end", stopReason: "end_turn", timestamp: "2026-11-28T00:00:06Z" }),
      ].join("\n"),
    )

    const messages = normalizeAcpRecords(records, "s-1")
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({
      role: "user",
      blocks: [{ type: "text", text: "Fix tests" }],
      timestamp: "2026-11-28T00:00:01Z",
      sessionId: "s-1",
    })
    expect(messages[1]).toEqual({
      role: "assistant",
      timestamp: "2026-11-28T00:00:02Z",
      sessionId: "s-1",
      blocks: [
        { type: "thinking", text: "Checking files" },
        { type: "tool_call", callId: "tc-1", name: "read_file", input: { path: "src/app.ts" } },
        { type: "tool_result", callId: "tc-1", output: "export const ok = true", isError: false },
        { type: "text", text: "All done." },
      ],
    })
  })

  it("marks failed tool updates and turn errors", () => {
    const records = parseAcpJsonl(
      [
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:01Z",
          update: { sessionUpdate: "tool_call", toolCallId: "tc-2", title: "Run build", status: "in_progress" },
        }),
        JSON.stringify({
          type: "session_update",
          timestamp: "2026-11-28T00:00:02Z",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc-2",
            status: "failed",
            content: [{ type: "content", content: { type: "text", text: "exit code 1" } }],
          },
        }),
        JSON.stringify({
          type: "turn_end",
          stopReason: "error",
          error: "provider timeout",
          timestamp: "2026-11-28T00:00:03Z",
        }),
      ].join("\n"),
    )
    const messages = normalizeAcpRecords(records, "s-2")
    expect(messages).toHaveLength(2)
    expect(messages[0]?.blocks[1]).toEqual({
      type: "tool_result",
      callId: "tc-2",
      output: "exit code 1",
      isError: true,
    })
    expect(messages[1]).toEqual({
      role: "system",
      blocks: [{ type: "text", text: "provider timeout" }],
      timestamp: "2026-11-28T00:00:03Z",
      sessionId: "s-2",
    })
  })

  it("maps ACP updates and stop reasons to Rove normalized activity kinds", () => {
    expect(activityFromAcpUpdate({ sessionUpdate: "tool_call", toolCallId: "1", name: "bash" })).toEqual({
      kind: "tool-pre",
      detail: { tool: { name: "bash", id: "1" } },
    })
    expect(
      activityFromAcpUpdate({ sessionUpdate: "tool_call_update", toolCallId: "1", name: "bash", status: "completed" }),
    ).toEqual({
      kind: "tool-post",
      detail: { tool: { name: "bash", id: "1" } },
    })
    expect(activityFromAcpUpdate({ sessionUpdate: "tool_call_update", toolCallId: "1", status: "failed" })).toEqual({
      kind: "tool-failed",
      detail: { tool: { id: "1" } },
    })
    expect(activityFromAcpUpdate({ sessionUpdate: "agent_message_chunk", content: "hi" })).toBeNull()
    expect(activityFromAcpStopReason("end_turn")).toBe("turn-complete")
    expect(activityFromAcpStopReason("cancelled")).toBe("turn-interrupted")
    expect(activityFromAcpStopReason("error")).toBe("turn-failed")
  })
})

describe("AcpClient JSON-RPC transport", () => {
  it("completes initialize, session/new, streaming session/prompt, permission request, and cancel", async () => {
    const agentOut = new PassThrough()
    const agentIn = new PassThrough()
    const received: Record<string, unknown>[] = []
    const updates: unknown[] = []

    let buf = ""
    agentIn.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8")
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        const msg = JSON.parse(line) as Record<string, unknown>
        received.push(msg)
        if (msg.method === "initialize") {
          agentOut.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, agentInfo: { name: "mock-acp" } },
            })}\n`,
          )
        } else if (msg.method === "session/new") {
          agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "sess-42" } })}\n`)
        } else if (msg.method === "session/prompt") {
          agentOut.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              method: "session/update",
              params: { sessionId: "sess-42", update: { sessionUpdate: "agent_message_chunk", content: "Hello" } },
            })}\n`,
          )
          agentOut.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              id: "perm-1",
              method: "session/request_permission",
              params: {
                sessionId: "sess-42",
                toolCall: { toolCallId: "t1", title: "Run shell" },
                options: [
                  { optionId: "allow", name: "Allow", kind: "allow_once" },
                  { optionId: "deny", name: "Deny", kind: "reject_once" },
                ],
              },
            })}\n`,
          )
          // Complete the prompt right after the permission response lands.
          const promptId = msg.id
          const waitPerm = (chunk2: Buffer): void => {
            if (!chunk2.toString("utf8").includes('"perm-1"')) return
            agentIn.off("data", waitPerm)
            agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } })}\n`)
          }
          agentIn.on("data", waitPerm)
        }
      }
    })

    const client = new AcpClient(agentOut, agentIn, {
      onUpdate: (_sid, update) => updates.push(update),
      onPermissionRequest: async (params) => pickAutoApproveOption(params.options),
    })

    const init = await client.initialize()
    expect(init.agentInfo?.name).toBe("mock-acp")
    const session = await client.newSession("/worktree")
    expect(session.sessionId).toBe("sess-42")
    const result = await client.prompt("sess-42", "Hi")
    expect(result.stopReason).toBe("end_turn")
    expect(updates).toEqual([{ sessionUpdate: "agent_message_chunk", content: "Hello" }])

    const cancelSeen = Promise.withResolvers<void>()
    agentIn.on("data", (c: Buffer) => {
      if (c.toString("utf8").includes('"session/cancel"')) cancelSeen.resolve()
    })
    client.cancel("sess-42")
    await cancelSeen.promise
    expect(received.some((m) => m.method === "session/cancel")).toBe(true)
    expect(
      received.some(
        (m) => m.id === "perm-1" && (m.result as { outcome?: { optionId?: string } })?.outcome?.optionId === "allow",
      ),
    ).toBe(true)
    client.close()
  })
})

describe("ACP history store and turn detector", () => {
  it("persists and reads sessions oldest-first with completion markers", async () => {
    const wt = "/repo/worktree-a"
    const file1 = appendAcpTranscriptRecord(
      wt,
      "sess-old",
      { type: "user_message", text: "first", timestamp: "2026-11-28T01:00:00Z" },
      home,
    )
    appendAcpTranscriptRecord(
      wt,
      "sess-old",
      {
        type: "session_update",
        update: { sessionUpdate: "agent_message_chunk", content: "reply 1" },
        timestamp: "2026-11-28T01:00:01Z",
      },
      home,
    )
    appendAcpTranscriptRecord(
      wt,
      "sess-old",
      { type: "turn_end", stopReason: "end_turn", timestamp: "2026-11-28T01:00:02Z" },
      home,
    )

    const reader = acpHistoryReaderFor(home)
    expect(await reader.listSessionIdsForWorktree(wt)).toEqual(["sess-old"])
    expect(await reader.transcriptPath("sess-old", wt)).toBe(file1)
    expect(await reader.latestTranscriptMtimeForWorktree(wt)).toBeGreaterThan(0)
    const msgs = await reader.readHistory("sess-old")
    expect(msgs).toHaveLength(2)
    expect(msgs[1]?.blocks[0]).toEqual({ type: "text", text: "reply 1" })

    const detector = new AcpTurnDetector(home)
    expect(detector.supportsCompletionMarkers()).toBe(true)
    const scan = await detector.latestActivity(wt)
    expect(scan.marker?.source).toBe("acp")
    expect(scan.marker?.timestampMs).toBe(Date.parse("2026-11-28T01:00:02Z"))
    const byFile = await detector.latestActivityInFile(file1)
    expect(byFile?.marker?.id).toBe(scan.marker?.id)
    expect(latestAcpCompletionMarkerFromJsonl("")).toBeNull()
  })
})

describe("ACP registry, preset, plugin, and launch wiring", () => {
  it("registers acp as a supported engine protocol with structured history and bridge wrapping", () => {
    expect(ENGINE_PROTOCOLS).toContain(ACP_PROTOCOL)
    const entry = engineEntry(ACP_PROTOCOL)
    expect(entry).toBe(ACP_ENGINE_ENTRY)
    expect(supportsStructuredHistory(ACP_PROTOCOL)).toBe(true)
    expect(entry.capabilities?.interruptSequence).toBe("\x03")

    writeState({
      "engines.permissionBypass": true,
      customEngineIds: ["zed-agent"],
      "engineCommand.zed-agent": "my-acp-cli --stdio",
      "engineProtocol.zed-agent": "acp",
    })
    expect(resolveCommandProtocol("zed-agent")).toBe("acp")
    const launch = engineLaunchArgv({ command: "zed-agent" })
    expect(launch).toContain("_acp-bridge")
    expect(launch).toContain("--bypass-permissions")
    expect(launch.slice(launch.indexOf("--") + 1)).toEqual(["my-acp-cli", "--stdio"])

    const resumed = engineResumeArgv(launch, "zed-agent", "sess-9")
    expect(resumed).not.toBeNull()
    expect(resumed).toContain("--resume")
    expect(resumed?.slice((resumed?.indexOf("--") ?? 0) + 1)).toEqual(["my-acp-cli", "--stdio"])

    const built = buildEngineSessionLaunch({
      task: { id: "t-1", kind: "task", vendor: "zed-agent", repo: "/repo" },
      worktreePath: "/repo/wt",
      shell: "/bin/sh",
      argv: launch,
      promptIntent: { kind: "explicit", prompt: "Solve it" },
    })
    expect(built.firstMessage).toBeUndefined()
    expect(built.command[2]).toContain("--prompt")
    expect(built.command[2]).toContain("Solve it")
  })

  it("parses _acp-bridge flags cleanly without colliding with agent args", () => {
    const wrapped = insertAcpBridgeFlags(
      ensureAcpBridgeWrapped(["agent-bin", "--resume", "agent-flag"], ["rove"]),
      ["--bypass-permissions", "--resume", "sess-1", "--prompt", "hi"],
      ["rove"],
    )
    expect(wrapped).toEqual([
      "rove",
      "_acp-bridge",
      "--bypass-permissions",
      "--resume",
      "sess-1",
      "--prompt",
      "hi",
      "--",
      "agent-bin",
      "--resume",
      "agent-flag",
    ])
    expect(parseAcpBridgeArgs(wrapped.slice(2))).toEqual({
      bypassPermissions: true,
      resumeSessionId: "sess-1",
      initialPrompt: "hi",
      agentArgv: ["agent-bin", "--resume", "agent-flag"],
    })
  })

  it("loads plugin [[engines]] with protocol = 'acp' without requiring screen rules", () => {
    const manifestDir = join(home, ".rove", "plugins", "acp.demo")
    mkdirSync(manifestDir, { recursive: true })
    const toml = [
      'id = "acp.demo"',
      'name = "ACP Demo"',
      'version = "0.1.0"',
      'min_rove_version = "0.9.0"',
      'platforms = ["macos", "linux"]',
      "[[engines]]",
      'id = "demo-acp"',
      'name = "Demo ACP"',
      'command = ["demo-acp-bin", "--acp"]',
      'protocol = "acp"',
    ].join("\n")
    expect(parsePluginManifest(toml).manifest.engines[0]?.protocol).toBe("acp")
    writeFileSync(join(manifestDir, "rove-plugin.toml"), toml, "utf8")
    savePluginRegistry(
      {
        plugins: [
          {
            id: "acp.demo",
            source: { kind: "link" },
            root: manifestDir,
            enabled: true,
            version: "0.1.0",
            installedAt: 1,
          },
        ],
      },
      home,
    )

    expect(loadPluginEngines(home)).toEqual(["demo-acp"])
    expect(isContribEngine("demo-acp")).toBe(true)
    expect(supportsStructuredHistory("demo-acp")).toBe(true)
    expect(engineEntry("demo-acp").createTurnDetector().supportsCompletionMarkers()).toBe(true)
  })

  it("identifies a running _acp-bridge child in the foreground process tree", () => {
    const rows = [
      { pid: 100, ppid: 1, args: "/bin/zsh -ilc ..." },
      { pid: 200, ppid: 100, args: "bun /path/rove.ts _acp-bridge -- unknown-acp-agent" },
    ]
    expect(foregroundEngineIn(rows, 100)?.vendor).toBe("acp")
  })
})
