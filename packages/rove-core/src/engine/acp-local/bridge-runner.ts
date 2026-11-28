/**
 * Interactive PTY host for ACP (`agent-client-protocol`) agents: `rove _acp-bridge`.
 *
 * Bridges a human/API PTY session on stdin/stdout to an ACP agent speaking JSON-RPC 2.0
 * on piped stdio:
 *  - Performs `initialize` + `session/new` (or `session/load` on `--resume`)
 *  - Streams `session/update` text/thinking/tool calls to both the terminal and Rove's
 *    ACP transcript JSONL store (driving `rove api read-output` and web `TranscriptView`)
 *  - Emits OSC 7501 program-status sequences so Rove's PTY host updates daemon activity
 *    badges (`working`, `blocked`, `done`, `error`) without per-CLI screen scraping
 *  - Translates Ctrl+C mid-turn into ACP `session/cancel`
 */

import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { flagValue, switchFlag } from "@sma1lboy/rove-core/lib/argv.ts"
import { AcpClient } from "./client.ts"
import { appendAcpTranscriptRecord } from "./history.ts"
import type {
  AcpPermissionOption,
  AcpPermissionOutcome,
  AcpPermissionRequestParams,
  AcpSessionUpdate,
  AcpToolCallProgressUpdate,
  AcpToolCallUpdate,
} from "./protocol.ts"
import { extractAcpText } from "./protocol.ts"

export interface ParsedAcpBridgeArgs {
  readonly resumeSessionId?: string
  readonly initialPrompt?: string
  readonly bypassPermissions: boolean
  readonly agentArgv: readonly string[]
}

/** Parse `rove _acp-bridge [--resume ID] [--prompt TEXT] [--bypass-permissions] -- <agent-argv...>`. */
export function parseAcpBridgeArgs(argv: readonly string[]): ParsedAcpBridgeArgs {
  const sep = argv.findIndex((token) => token === "--")
  const bridgeFlags = sep >= 0 ? argv.slice(0, sep) : []
  const agentArgv = sep >= 0 ? argv.slice(sep + 1) : argv
  const resumeSessionId = flagValue(bridgeFlags, "--resume")
  const initialPrompt = flagValue(bridgeFlags, "--prompt")
  const bypassPermissions = switchFlag(bridgeFlags, "--bypass-permissions") === true
  return {
    ...(resumeSessionId ? { resumeSessionId } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
    bypassPermissions,
    agentArgv,
  }
}

/** Pick the safest auto-approve option when `--bypass-permissions` is enabled. */
export function pickAutoApproveOption(options: readonly AcpPermissionOption[]): AcpPermissionOutcome {
  const preferred =
    options.find((o) => o.kind === "allow_always") ?? options.find((o) => o.kind === "allow_once") ?? options[0]
  return preferred ? { outcome: "selected", optionId: preferred.optionId } : { outcome: "cancelled" }
}

function osc7501(state: "working" | "blocked" | "done" | "idle" | "error", extra = ""): void {
  process.stdout.write(`\x1b]7501;state=${state}${extra}\x07`)
}

function oscTitle(title: string): void {
  process.stdout.write(`\x1b]0;${title}\x07`)
}

/** Run `rove _acp-bridge`. Exits with the agent's exit code (or 1 on setup error). */
export async function runAcpBridgeSubcommand(argv: readonly string[]): Promise<void> {
  const parsed = parseAcpBridgeArgs(argv)
  const [cmd, ...cmdArgs] = parsed.agentArgv
  if (!cmd) {
    process.stderr.write("rove _acp-bridge: missing agent command after `--`\n")
    process.exit(2)
  }

  const cwd = process.cwd()
  const child = spawn(cmd, cmdArgs, {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
  })

  if (!child.stdout || !child.stdin) {
    process.stderr.write(`rove _acp-bridge: failed to open stdio pipes for ${cmd}\n`)
    process.exit(1)
  }

  let activeSessionId = ""
  let turnActive = false
  let awaitingPermission: ((line: string) => void) | null = null
  let streamedNewline = true

  const writeOut = (text: string): void => {
    if (!text) return
    process.stdout.write(text)
    streamedNewline = text.endsWith("\n")
  }

  const ensureNewline = (): void => {
    if (!streamedNewline) writeOut("\n")
  }

  const client = new AcpClient(child.stdout, child.stdin, {
    onUpdate: (sid, update: AcpSessionUpdate) => {
      const targetSid = sid || activeSessionId
      if (targetSid) {
        appendAcpTranscriptRecord(cwd, targetSid, {
          type: "session_update",
          update,
          timestamp: new Date().toISOString(),
        })
      }
      renderUpdateToTerminal(update, writeOut, ensureNewline)
    },
    onPermissionRequest: async (params: AcpPermissionRequestParams): Promise<AcpPermissionOutcome> => {
      if (parsed.bypassPermissions) return pickAutoApproveOption(params.options)
      ensureNewline()
      osc7501("blocked", ":kind=permission")
      const label = params.toolCall?.title ?? params.toolCall?.name ?? "Tool permission"
      writeOut(`\n[permission] ${label}\n`)
      params.options.forEach((opt, i) => writeOut(`  ${i + 1}) ${opt.name}\n`))
      writeOut("Select option (number, or empty to cancel): ")
      const choice = await new Promise<string>((resolve) => {
        awaitingPermission = resolve
      })
      awaitingPermission = null
      osc7501("working")
      const idx = Number.parseInt(choice.trim(), 10) - 1
      const picked = Number.isInteger(idx) && idx >= 0 ? params.options[idx] : undefined
      return picked ? { outcome: "selected", optionId: picked.optionId } : { outcome: "cancelled" }
    },
  })

  const exitPromise = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0))
    child.on("error", (err) => {
      process.stderr.write(`rove _acp-bridge: failed to launch ${cmd}: ${err.message}\n`)
      resolve(1)
    })
  })

  let initRes: Awaited<ReturnType<AcpClient["initialize"]>>
  try {
    initRes = await client.initialize()
  } catch (err) {
    process.stderr.write(`rove _acp-bridge: initialize failed: ${err instanceof Error ? err.message : String(err)}\n`)
    child.kill()
    process.exit(1)
  }

  const agentName = initRes.agentInfo?.title ?? initRes.agentInfo?.name ?? cmd
  oscTitle(agentName)

  try {
    if (parsed.resumeSessionId && initRes.agentCapabilities?.loadSession) {
      activeSessionId = parsed.resumeSessionId
      await client.loadSession(activeSessionId, cwd)
    } else {
      const created = await client.newSession(cwd)
      activeSessionId = created.sessionId
    }
  } catch (err) {
    process.stderr.write(
      `rove _acp-bridge: session setup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    child.kill()
    process.exit(1)
  }

  appendAcpTranscriptRecord(cwd, activeSessionId, {
    type: "session_meta",
    sessionId: activeSessionId,
    cwd,
    agentName,
    ...(initRes.agentInfo?.version ? { agentVersion: initRes.agentInfo.version } : {}),
    timestamp: new Date().toISOString(),
  })
  osc7501("idle")
  writeOut(`${agentName} (ACP session ${activeSessionId})\n`)

  const runTurn = async (promptText: string): Promise<void> => {
    const text = promptText.trim()
    if (!text) return
    turnActive = true
    appendAcpTranscriptRecord(cwd, activeSessionId, {
      type: "user_message",
      text,
      timestamp: new Date().toISOString(),
    })
    osc7501("working")
    try {
      const res = await client.prompt(activeSessionId, text)
      ensureNewline()
      appendAcpTranscriptRecord(cwd, activeSessionId, {
        type: "turn_end",
        stopReason: res.stopReason,
        timestamp: new Date().toISOString(),
      })
      osc7501("done")
    } catch (err) {
      ensureNewline()
      const msg = err instanceof Error ? err.message : String(err)
      writeOut(`\x1b[31mError: ${msg}\x1b[0m\n`)
      appendAcpTranscriptRecord(cwd, activeSessionId, {
        type: "turn_end",
        stopReason: "error",
        error: msg,
        timestamp: new Date().toISOString(),
      })
      osc7501("error")
    } finally {
      turnActive = false
    }
  }

  process.on("SIGINT", () => {
    if (turnActive && activeSessionId) {
      client.cancel(activeSessionId)
      return
    }
    client.close()
    child.kill()
    process.exit(0)
  })

  if (parsed.initialPrompt) await runTurn(parsed.initialPrompt)

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "\n> " })
  const queue: string[] = []
  let draining = false

  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    while (queue.length > 0) {
      const next = queue.shift()
      if (next !== undefined) await runTurn(next)
    }
    draining = false
    if (!child.killed && child.exitCode === null) rl.prompt()
  }

  rl.on("line", (line) => {
    // Strip bracketed paste wrappers if the terminal sent them raw.
    const clean = line.replaceAll("\x1b[200~", "").replaceAll("\x1b[201~", "")
    if (awaitingPermission) {
      awaitingPermission(clean)
      return
    }
    if (!clean.trim()) {
      if (!turnActive) rl.prompt()
      return
    }
    queue.push(clean)
    void drain()
  })

  rl.on("close", () => {
    client.close()
    child.kill()
  })

  rl.prompt()
  const code = await exitPromise
  rl.close()
  client.close()
  process.exit(code)
}

function renderUpdateToTerminal(
  update: AcpSessionUpdate,
  writeOut: (s: string) => void,
  ensureNewline: () => void,
): void {
  if (update.sessionUpdate === "agent_message_chunk") {
    writeOut(extractAcpText(update.content))
    return
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    const text = extractAcpText(update.content)
    if (text) writeOut(`\x1b[2m${text}\x1b[0m`)
    return
  }
  if (update.sessionUpdate === "tool_call") {
    const call = update as AcpToolCallUpdate
    ensureNewline()
    writeOut(`\x1b[2m[tool] ${call.name ?? call.title ?? call.toolCallId}\x1b[0m\n`)
    return
  }
  if (update.sessionUpdate === "tool_call_update") {
    const progress = update as AcpToolCallProgressUpdate
    if (progress.status === "failed") {
      ensureNewline()
      writeOut(`\x1b[31m[tool failed] ${progress.name ?? progress.title ?? progress.toolCallId}\x1b[0m\n`)
    }
  }
}
