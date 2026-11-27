/**
 * The bridge the iPhone app's demo talks to: a `fetch` and a `WebSocket` that answer from the fixture
 * the app ships, with no network. Installed as `__roveRelay` (`relay-transport.ts`) before the client runs.
 * Every op answers success; only settings are kept, in memory.
 */

import fixture from "../../../rove-ios/Sources/RoveMobile/Demo/demo-fixture.json"
import type { RelayTransport } from "../relay-transport.ts"
import extras from "./web-fixture.json"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Obj = { [key: string]: Json }

const ops: Obj = { ...(fixture as unknown as Obj), ...(extras as unknown as Obj) }

const isObj = (v: Json | undefined): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v)

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
}

/** `$ago_min` / `$in_min` become times around now, `$b64` the base64 of its text. */
function resolve(value: Json, now: number): Json {
  if (Array.isArray(value)) return value.map((v) => resolve(v, now))
  if (!isObj(value)) return value
  const minutes = value.$ago_min ?? value.$in_min
  if (typeof minutes === "number") {
    const at = now + (value.$ago_min === undefined ? 1 : -1) * minutes * 60_000
    return value.$as === "ms" ? at : new Date(at).toISOString()
  }
  if (typeof value.$b64 === "string") return base64(value.$b64)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, now)]))
}

/** One request's answer: the op's entry, through `$same_as`, picked by `$by`; an unknown op answers `{}`. */
export function answer(op: string, args: Obj = {}, now = Date.now()): Json {
  // The one write that is kept (in memory): the client waits for a setting to read back changed.
  if (op === "prefs.set" && isObj(ops["prefs.get"]) && isObj(ops["prefs.get"].prefs) && typeof args.key === "string") {
    ops["prefs.get"].prefs[args.key] = args.value ?? null
    return { prefs: ops["prefs.get"].prefs }
  }
  let entry: Json = ops[op] ?? {}
  if (isObj(entry) && typeof entry.$same_as === "string") entry = ops[entry.$same_as] ?? {}
  if (isObj(entry) && entry.$by !== undefined) {
    const fields = Array.isArray(entry.$by) ? entry.$by : [entry.$by]
    entry = entry[fields.map((f) => String(args[String(f)] ?? "")).join(":")] ?? entry["*"] ?? {}
  }
  return resolve(entry, now)
}

class DemoSocket {
  static readonly OPEN = 1
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: Event) => void) | null = null

  constructor() {
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.(new Event("open"))
    })
  }

  send(data: string): void {
    const { id, op, args } = JSON.parse(data) as { id: number; op: string; args?: Obj }
    // A task, not a microtask: a client loop that asks again on every answer must not starve the page.
    setTimeout(() => this.onmessage?.({ data: JSON.stringify({ id, ok: true, result: answer(op, args) }) }))
  }

  close(): void {
    this.readyState = 3
  }
}

export const demoTransport: RelayTransport = {
  // `/auth` says this bridge wants no token, so the client starts without a sign-in screen.
  fetch: async (path) => (path === "/auth" ? Response.json({ open: true }) : Response.json({}, { status: 404 })),
  WebSocket: DemoSocket as unknown as RelayTransport["WebSocket"],
}
