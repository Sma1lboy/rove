/**
 * Argument schema helpers for area ops, beyond `str`/`optStr`/`optInt`/`optBool` in
 * protocol.ts. Every value that reaches a `rove api` argv goes through {@link flag}, so a
 * phone-supplied string can never be read as another flag.
 */

import { BridgeError } from "../protocol.ts"
import type { Args } from "./types.ts"

/** `--name=value`: the verb parser splits on the first `=`, so a value starting `--` stays a value. */
export function flag(name: string, value: string | number): string {
  return `--${name}=${value}`
}

/** A required string from a closed set. */
export function oneOf<const T extends string>(args: Args, name: string, values: readonly T[]): T {
  const v = args[name]
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    throw new BridgeError("BAD_ARGS", `${name} must be one of ${values.join("|")}`)
  }
  return v as T
}

/** An optional string from a closed set. */
export function optOneOf<const T extends string>(args: Args, name: string, values: readonly T[]): T | undefined {
  const v = args[name]
  if (v === undefined || v === null || v === "") return undefined
  return oneOf(args, name, values)
}

/** A required boolean (no default). */
export function bool(args: Args, name: string): boolean {
  const v = args[name]
  if (typeof v !== "boolean") throw new BridgeError("BAD_ARGS", `${name} must be a boolean`)
  return v
}

/** Text with a length cap: prompts, bodies, notes. */
export function text(args: Args, name: string, max: number): string {
  const v = args[name]
  if (typeof v !== "string" || v.trim().length === 0)
    throw new BridgeError("BAD_ARGS", `${name} must be non-empty text`)
  if (v.length > max) throw new BridgeError("BAD_ARGS", `${name} is longer than ${max} characters`)
  return v
}

/** Optional capped text. */
export function optText(args: Args, name: string, max: number): string | undefined {
  const v = args[name]
  if (v === undefined || v === null || v === "") return undefined
  return text(args, name, max)
}

/** The `taskId` most ops take, checked for shape (ids are ULIDs; refuse anything flag-like). */
export function taskId(args: Args, name = "taskId"): string {
  const v = args[name]
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v))
    throw new BridgeError("BAD_ARGS", `${name} is not a task id`)
  return v
}

/** A tab id as `get-task` reports it (`tab-N`). */
export function tabId(args: Args, name = "tabId"): string {
  const v = args[name]
  if (typeof v !== "string" || !/^tab-\d{1,6}$/.test(v)) throw new BridgeError("BAD_ARGS", `${name} is not a tab id`)
  return v
}

/** An absolute path (repos, worktrees). */
export function absPath(args: Args, name: string): string {
  const v = args[name]
  if (typeof v !== "string" || !v.startsWith("/") || v.includes("\0")) {
    throw new BridgeError("BAD_ARGS", `${name} must be an absolute path`)
  }
  return v
}
