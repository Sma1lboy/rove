import type { ProgramStatus } from "./osc-signals"

export interface ProgramStatusEvent {
  readonly key: string
  readonly generation: string
  readonly revision: number
  readonly at: number
  readonly status: ProgramStatus | null
}

/** Validate the host socket boundary before a report can change activity. */
export function parseProgramStatusEvent(value: unknown): ProgramStatusEvent | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("key" in value) ||
    typeof value.key !== "string" ||
    !("generation" in value) ||
    typeof value.generation !== "string" ||
    !("revision" in value) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !("at" in value) ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    !("status" in value)
  )
    return null
  const raw = value.status
  let status: ProgramStatus | null = null
  if (raw !== null) {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("id" in raw) ||
      raw.id !== "" ||
      !("state" in raw) ||
      !("at" in raw) ||
      typeof raw.at !== "number" ||
      !Number.isFinite(raw.at)
    )
      return null
    const state = raw.state
    if (state !== "idle" && state !== "working" && state !== "done" && state !== "blocked" && state !== "error")
      return null
    status = {
      id: "",
      state,
      at: raw.at,
      ...("kind" in raw && (raw.kind === "permission" || raw.kind === "question" || raw.kind === "auth")
        ? { kind: raw.kind }
        : {}),
      ...("msg" in raw && typeof raw.msg === "string" ? { msg: raw.msg.slice(0, 2048) } : {}),
    }
  }
  return { key: value.key, generation: value.generation, revision: value.revision, at: value.at, status }
}
