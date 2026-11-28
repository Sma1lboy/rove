/**
 * Zero-dependency ACP JSON-RPC 2.0 NDJSON client over an arbitrary Readable/Writable pair.
 * Handles `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`,
 * inbound `session/update` notifications, and inbound `session/request_permission` requests.
 */

import type { Readable, Writable } from "node:stream"
import { isObject } from "@sma1lboy/rove-core/lib/is-object.ts"
import { CURRENT_VERSION } from "@sma1lboy/rove-core/version.ts"
import {
  ACP_PROTOCOL_VERSION,
  type AcpInitializeResult,
  type AcpNewSessionResult,
  type AcpPermissionOutcome,
  type AcpPermissionRequestParams,
  type AcpPromptResult,
  type AcpSessionUpdate,
} from "./protocol.ts"

export interface AcpClientCallbacks {
  readonly onUpdate?: (sessionId: string, update: AcpSessionUpdate) => void
  readonly onPermissionRequest?: (params: AcpPermissionRequestParams) => Promise<AcpPermissionOutcome>
  readonly onClose?: (err?: Error) => void
}

interface PendingRpc {
  readonly resolve: (result: unknown) => void
  readonly reject: (err: Error) => void
}

export class AcpClient {
  private nextId = 1
  private buffer = ""
  private closed = false
  private readonly pending = new Map<number | string, PendingRpc>()
  private readonly onData: (chunk: Buffer | string) => void
  private readonly onEnd: () => void
  private readonly onError: (err: Error) => void

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly callbacks: AcpClientCallbacks = {},
  ) {
    this.onData = (chunk) => this.consume(typeof chunk === "string" ? chunk : chunk.toString("utf8"))
    this.onEnd = () => this.finish()
    this.onError = (err) => this.finish(err)
    this.input.on("data", this.onData)
    this.input.on("end", this.onEnd)
    this.input.on("close", this.onEnd)
    this.input.on("error", this.onError)
  }

  /** Perform the ACP `initialize` handshake and return the agent's negotiated capabilities + info. */
  initialize(clientInfo = { name: "rove", version: CURRENT_VERSION }): Promise<AcpInitializeResult> {
    return this.request<AcpInitializeResult>("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo,
    })
  }

  newSession(cwd: string, mcpServers: readonly unknown[] = []): Promise<AcpNewSessionResult> {
    return this.request<AcpNewSessionResult>("session/new", { cwd, mcpServers })
  }

  async loadSession(sessionId: string, cwd: string, mcpServers: readonly unknown[] = []): Promise<void> {
    await this.request("session/load", { sessionId, cwd, mcpServers })
  }

  prompt(sessionId: string, text: string): Promise<AcpPromptResult> {
    return this.request<AcpPromptResult>("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    })
  }

  /** Send a `session/cancel` notification to interrupt an in-flight turn. */
  cancel(sessionId: string): void {
    this.notify("session/cancel", { sessionId })
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`ACP client is closed (${method})`))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject })
      this.writeLine({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return
    this.writeLine({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) })
  }

  close(): void {
    this.finish()
  }

  private writeLine(frame: unknown): void {
    try {
      this.output.write(`${JSON.stringify(frame)}\n`)
    } catch (err) {
      this.finish(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private consume(text: string): void {
    this.buffer += text
    for (;;) {
      const nl = this.buffer.indexOf("\n")
      if (nl < 0) break
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line) continue
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      // Non-JSON diagnostic lines on stdout are ignored rather than crashing the stream.
      return
    }
    if (!isObject(raw)) return
    const hasId = typeof raw.id === "number" || typeof raw.id === "string"
    const hasMethod = typeof raw.method === "string"

    // Response to an outbound client → agent request.
    if (hasId && !hasMethod) {
      const pending = this.pending.get(raw.id as number | string)
      if (!pending) return
      this.pending.delete(raw.id as number | string)
      if (isObject(raw.error)) {
        const msg = typeof raw.error.message === "string" ? raw.error.message : "ACP RPC error"
        const code = typeof raw.error.code === "number" ? raw.error.code : -32000
        pending.reject(new Error(`ACP error ${code}: ${msg}`))
      } else {
        pending.resolve(raw.result)
      }
      return
    }

    // Inbound agent → client notification (`session/update`).
    if (hasMethod && !hasId) {
      if (raw.method === "session/update" && isObject(raw.params)) {
        const sessionId = typeof raw.params.sessionId === "string" ? raw.params.sessionId : ""
        const update = raw.params.update
        if (isObject(update) && typeof update.sessionUpdate === "string") {
          this.callbacks.onUpdate?.(sessionId, update as AcpSessionUpdate)
        }
      }
      return
    }

    // Inbound agent → client request (e.g. `session/request_permission`).
    if (hasMethod && hasId) {
      void this.handleInboundRequest(raw.id as number | string, raw.method as string, raw.params)
    }
  }

  private async handleInboundRequest(id: number | string, method: string, params: unknown): Promise<void> {
    if (method === "session/request_permission" && isObject(params)) {
      const req: AcpPermissionRequestParams = {
        sessionId: typeof params.sessionId === "string" ? params.sessionId : "",
        ...(isObject(params.toolCall) ? { toolCall: params.toolCall } : {}),
        options: Array.isArray(params.options) ? params.options : [],
      }
      try {
        const outcome: AcpPermissionOutcome = this.callbacks.onPermissionRequest
          ? await this.callbacks.onPermissionRequest(req)
          : { outcome: "cancelled" }
        this.writeLine({ jsonrpc: "2.0", id, result: { outcome } })
      } catch (err) {
        this.writeLine({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        })
      }
      return
    }
    this.writeLine({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not supported by Rove ACP client: ${method}` },
    })
  }

  private finish(err?: Error): void {
    if (this.closed) return
    this.closed = true
    this.input.off("data", this.onData)
    this.input.off("end", this.onEnd)
    this.input.off("close", this.onEnd)
    this.input.off("error", this.onError)
    const reason = err ?? new Error("ACP agent closed the connection")
    for (const pending of this.pending.values()) pending.reject(reason)
    this.pending.clear()
    this.callbacks.onClose?.(err)
  }
}
