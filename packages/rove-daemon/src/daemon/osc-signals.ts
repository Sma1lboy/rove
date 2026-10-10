import { StringDecoder } from "node:string_decoder"
import type { EngineActivityDetail, EngineActivityKind } from "./contracts"

export interface ProgramStatus {
  readonly id: string
  readonly state: "idle" | "working" | "done" | "blocked" | "error"
  readonly at: number
  readonly kind?: "permission" | "question" | "auth"
  readonly msg?: string
  readonly title?: string
  readonly app?: string
  readonly progress?: number
}
export interface OscContext {
  readonly id: string
  readonly metadata: Readonly<Record<string, string>>
}
export interface OscSignals {
  carry: string
  decoder: StringDecoder
  records: Map<string, ProgramStatus>
  contexts: OscContext[]
}
export function createOscSignals(): OscSignals {
  return { carry: "", decoder: new StringDecoder("utf8"), records: new Map(), contexts: [] }
}

function freeText(raw: string | undefined, encodedLimit: number, decodedLimit: number): string | undefined {
  if (raw === undefined) return undefined
  if (raw.length > encodedLimit || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.replace(/=+$/, "").length % 4 === 1)
    throw new Error("Invalid base64")
  const bytes = Buffer.from(raw, "base64")
  if (bytes.length > decodedLimit) throw new Error("Text exceeds limit")
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: protocol rejects controls
  if (/[\x00-\x1f\x7f-\x9f]/u.test(text)) throw new Error("Control character")
  return text
}

export function applyProgramStatus(signals: OscSignals, body: string, now: number): void {
  if (Buffer.byteLength(body) + 10 > 4096) return
  const pairs: Record<string, string> = Object.create(null)
  for (const pair of body.split(":")) {
    const split = pair.indexOf("=")
    if (split < 1) continue
    const key = pair.slice(0, split).trim()
    const value = pair.slice(split + 1).trim()
    if (key.length > 16) return
    if (/^[a-z]+$/.test(key) && /^[A-Za-z0-9_.,+/=-]*$/.test(value)) pairs[key] = value
  }
  const id = pairs.id ?? ""
  if (
    pairs.id !== undefined &&
    (id.length > 128 || id.split("/").length > 8 || !/^[A-Za-z0-9_.+-]{1,32}(\/[A-Za-z0-9_.+-]{1,32})*$/.test(id))
  )
    return
  const state = pairs.state
  if (!["idle", "working", "done", "blocked", "error", "clear"].includes(state ?? "")) return
  let msg: string | undefined
  let title: string | undefined
  try {
    msg = freeText(pairs.msg, 2732, 2048)
    title = freeText(pairs.title, 256, 192)
  } catch {
    return
  }
  if (pairs.app !== undefined && pairs.app.length > 32) return
  if (state === "clear") {
    for (const key of signals.records.keys())
      if (!id || key === id || key.startsWith(`${id}/`)) signals.records.delete(key)
    return
  }
  if (state !== "idle" && state !== "working" && state !== "done" && state !== "blocked" && state !== "error") return
  const kind =
    pairs.kind === "permission" || pairs.kind === "question" || pairs.kind === "auth" ? pairs.kind : undefined
  const progress =
    pairs.progress !== undefined && /^\d{1,3}$/.test(pairs.progress) && Number(pairs.progress) <= 100
      ? Number(pairs.progress)
      : undefined
  signals.records.delete(id)
  signals.records.set(id, {
    id,
    state,
    at: now,
    ...(msg !== undefined ? { msg } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(pairs.app && /^[A-Za-z0-9_.+-]{1,32}$/.test(pairs.app) ? { app: pairs.app } : {}),
    ...(state === "blocked" && kind ? { kind } : {}),
    ...((state === "working" || state === "blocked") && progress !== undefined ? { progress } : {}),
  })
  if (signals.records.size > 64) {
    const first = signals.records.keys().next().value
    if (first !== undefined) signals.records.delete(first)
  }
}

function applyContext(signals: OscSignals, body: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: UAPI rejects controls in fields
  if (Buffer.byteLength(body) > 4096 || /[\x00-\x1f\x7f]/.test(body)) return
  const [head = "", ...fields] = body.split(";")
  const split = head.indexOf("=")
  const operation = head.slice(0, split)
  const decodeContextField = (text: string) =>
    text.replace(/\\x(3b|5c)/g, (_, hex: string) => (hex === "3b" ? ";" : "\\"))
  const id = decodeContextField(head.slice(split + 1))
  if ((operation !== "start" && operation !== "end") || !/^[ -~]{1,64}$/.test(id)) return
  const index = signals.contexts.findIndex((c) => c.id === id)
  if (operation === "end") {
    if (index !== -1) signals.contexts.splice(index)
    return
  }
  if (index !== -1) signals.contexts.splice(index)
  if (signals.contexts.length >= 32) return
  const metadata: Record<string, string> = Object.create(null)
  for (const field of fields) {
    const i = field.indexOf("=")
    if (i > 0) metadata[field.slice(0, i)] = decodeContextField(field.slice(i + 1))
  }
  signals.contexts.push({ id, metadata })
}

export function clearTransientStatuses(signals: OscSignals): void {
  for (const [id, record] of signals.records) {
    if (record.state === "working" || record.state === "blocked" || record.state === "idle") signals.records.delete(id)
  }
}

/** Stream framing keeps incomplete sequences only, including a split ST. */
export function scanOscSignals(
  signals: OscSignals,
  bytes: Buffer,
  now = Date.now(),
  onRootChange?: (status: ProgramStatus | null) => void,
): number {
  const text = signals.carry + signals.decoder.write(bytes)
  signals.carry = ""
  let queries = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\x1b") continue
    if (i === text.length - 1) {
      signals.carry = "\x1b"
      break
    }
    if (text[i + 1] === "c") {
      const hadRoot = signals.records.has("")
      signals.records.clear()
      if (hadRoot) onRootChange?.(null)
      signals.contexts = []
      i++
      continue
    }
    if (text[i + 1] !== "]") continue
    const begin = i
    i += 2
    let end = i
    while (end < text.length && text[end] !== "\x07" && text[end] !== "\x1b") end++
    if (end === text.length || (text[end] === "\x1b" && end + 1 === text.length)) {
      if (text.length - begin <= 8192) signals.carry = text.slice(begin)
      break
    }
    if (text[end] === "\x1b" && text[end + 1] !== "\\") {
      i = end - 1
      continue
    }
    const before = signals.records.get("")
    const body = text.slice(i, end)
    if (body === "7501;?") queries++
    else if (body.startsWith("7501;")) applyProgramStatus(signals, body.slice(5), now)
    else if (body.startsWith("3008;")) applyContext(signals, body.slice(5))
    else if (body === "133;A" || body.startsWith("133;A;")) clearTransientStatuses(signals)
    const after = signals.records.get("")
    if (before !== after) onRootChange?.(after ?? null)
    i = end + (text[end] === "\x1b" ? 1 : 0)
  }
  return queries
}

export function statusActivity(status: ProgramStatus): { kind: EngineActivityKind; detail?: EngineActivityDetail } {
  const kind: EngineActivityKind =
    status.state === "working"
      ? "turn-start"
      : status.state === "done"
        ? "turn-complete"
        : status.state === "blocked"
          ? "awaiting-input"
          : status.state === "error"
            ? "turn-failed"
            : "turn-interrupted"
  return {
    kind,
    detail: {
      ...(status.msg ? { note: status.msg } : {}),
      ...(status.state === "blocked"
        ? ({ waiting: status.kind === "permission" ? "permission" : "input" } as const)
        : {}),
      ...(status.state === "error" ? ({ failure: "other" } as const) : {}),
    },
  }
}
