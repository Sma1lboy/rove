/**
 * Agent Client Protocol (ACP) wire types (JSON-RPC 2.0 over newline-delimited stdio).
 * Engine-owned schema: neutral layers consume Rove's `Message` / `EngineActivityKind`
 * produced by `normalize.ts`, never raw ACP frames.
 */

import { isObject } from "@sma1lboy/rove-core/lib/is-object.ts"

export const ACP_PROTOCOL_VERSION = 1

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly id: number | string
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0"
  readonly id: number | string
  readonly result?: unknown
  readonly error?: JsonRpcError
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export interface AcpClientInfo {
  readonly name: string
  readonly version: string
  readonly title?: string
}

export interface AcpAgentInfo {
  readonly name?: string
  readonly version?: string
  readonly title?: string
}

export interface AcpAgentCapabilities {
  readonly loadSession?: boolean
  readonly promptCapabilities?: {
    readonly image?: boolean
    readonly audio?: boolean
    readonly embeddedContext?: boolean
  }
  readonly mcpCapabilities?: {
    readonly http?: boolean
    readonly sse?: boolean
  }
}

export interface AcpInitializeParams {
  readonly protocolVersion: number
  readonly clientCapabilities: {
    readonly fs?: { readonly readTextFile?: boolean; readonly writeTextFile?: boolean }
    readonly terminal?: boolean
  }
  readonly clientInfo: AcpClientInfo
}

export interface AcpInitializeResult {
  readonly protocolVersion: number
  readonly agentCapabilities?: AcpAgentCapabilities
  readonly agentInfo?: AcpAgentInfo
}

export interface AcpNewSessionParams {
  readonly cwd: string
  readonly mcpServers: readonly unknown[]
}

export interface AcpNewSessionResult {
  readonly sessionId: string
  readonly modes?: {
    readonly currentModeId?: string
    readonly availableModes?: readonly { readonly id: string; readonly name: string }[]
  }
  readonly models?: {
    readonly currentModelId?: string
    readonly availableModels?: readonly { readonly modelId: string; readonly name: string }[]
  }
}

export interface AcpLoadSessionParams {
  readonly sessionId: string
  readonly cwd: string
  readonly mcpServers: readonly unknown[]
}

export interface AcpContentBlock {
  readonly type: string
  readonly text?: string
  readonly [key: string]: unknown
}

export interface AcpPromptParams {
  readonly sessionId: string
  readonly prompt: readonly AcpContentBlock[]
}

export type AcpStopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | (string & {})

export interface AcpPromptResult {
  readonly stopReason: AcpStopReason
}

export interface AcpCancelParams {
  readonly sessionId: string
}

export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed" | (string & {})

export interface AcpSessionUpdateBase {
  readonly sessionUpdate: string
  readonly [key: string]: unknown
}

export interface AcpMessageChunkUpdate extends AcpSessionUpdateBase {
  readonly sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk"
  readonly content?: string | AcpContentBlock
}

export interface AcpToolCallUpdate extends AcpSessionUpdateBase {
  readonly sessionUpdate: "tool_call"
  readonly toolCallId: string
  readonly title?: string
  readonly name?: string
  readonly kind?: string
  readonly status?: AcpToolStatus
  readonly rawInput?: unknown
  readonly input?: unknown
}

export interface AcpToolCallProgressUpdate extends AcpSessionUpdateBase {
  readonly sessionUpdate: "tool_call_update"
  readonly toolCallId: string
  readonly title?: string
  readonly name?: string
  readonly status?: AcpToolStatus
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
  readonly output?: unknown
  readonly result?: unknown
  readonly content?: unknown
}

export type AcpSessionUpdate =
  | AcpMessageChunkUpdate
  | AcpToolCallUpdate
  | AcpToolCallProgressUpdate
  | AcpSessionUpdateBase

export interface AcpSessionUpdateParams {
  readonly sessionId: string
  readonly update: AcpSessionUpdate
}

export interface AcpPermissionOption {
  readonly optionId: string
  readonly name: string
  readonly kind?: "allow_once" | "allow_always" | "reject_once" | "reject_always" | (string & {})
}

export interface AcpPermissionRequestParams {
  readonly sessionId: string
  readonly toolCall?: {
    readonly toolCallId?: string
    readonly title?: string
    readonly name?: string
    readonly rawInput?: unknown
  }
  readonly options: readonly AcpPermissionOption[]
}

export type AcpPermissionOutcome =
  | { readonly outcome: "selected"; readonly optionId: string }
  | { readonly outcome: "cancelled" }

/** Transcript record written to `<ROVE_HOME>/.rove/acp-sessions/<cwd>/<sessionId>.jsonl`. */
export type AcpTranscriptRecord =
  | {
      readonly type: "session_meta"
      readonly sessionId: string
      readonly cwd: string
      readonly agentName?: string
      readonly agentVersion?: string
      readonly timestamp: string
    }
  | {
      readonly type: "user_message"
      readonly text: string
      readonly timestamp: string
    }
  | {
      readonly type: "session_update"
      readonly update: AcpSessionUpdate
      readonly timestamp: string
    }
  | {
      readonly type: "turn_end"
      readonly stopReason: AcpStopReason
      readonly error?: string
      readonly timestamp: string
    }

/** Extract plain text from either a string or an ACP `ContentBlock` (`{ type: "text", text }`). */
export function extractAcpText(content: unknown): string {
  if (typeof content === "string") return content
  if (!isObject(content)) return ""
  if (typeof content.text === "string") return content.text
  if (isObject(content.content) && typeof content.content.text === "string") return content.content.text
  return ""
}

/** Extract readable tool output from `rawOutput`, `output`, `result`, or structured `content[]`. */
export function extractAcpToolOutput(update: AcpToolCallProgressUpdate): unknown {
  if (update.rawOutput !== undefined) return update.rawOutput
  if (update.output !== undefined) return update.output
  if (update.result !== undefined) return update.result
  if (Array.isArray(update.content)) {
    const texts = update.content.map(extractAcpText).filter((t) => t.length > 0)
    if (texts.length > 0) return texts.join("\n")
    return update.content
  }
  if (update.content !== undefined) return extractAcpText(update.content) || update.content
  return ""
}
