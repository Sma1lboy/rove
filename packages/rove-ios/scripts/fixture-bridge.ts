// A canned-answer bridge on :7896 (token "fixture") that serves the SAME file the app's in-app demo
// bridge answers from: Sources/RoveMobile/Demo/demo-fixture.json. It exists to look at states the
// sandbox cannot produce (stale daemon, warn/ok quota meters, plugins, GitHub issues, every routine
// run tone, a need-you card floating on the board) and to run PagesFixtureTests.
//   bun packages/rove-ios/scripts/fixture-bridge.ts
//   TEST_RUNNER_ROVE_FIXTURE_URL=ws://127.0.0.1:7896/?token=fixture
//
// Fixture format (resolved identically by Demo/DemoFixture.swift):
//   top level      { "<op>": <result> }; an op that is missing answers {}.
//   $by            { "$by": "taskId" | ["taskId","tabId"], "T-1": <result>, "T-1:tab-1": …, "*": <fallback> }
//                  picks the result by the request's args (composite keys join with ":").
//   $same_as       { "$same_as": "<op>" } answers like another op.
//   $ago_min / $in_min   { "$ago_min": 5 } is an ISO-8601 time 5 minutes before now; with
//                  "$as": "ms" it is epoch milliseconds instead.
//   $b64           { "$b64": "text" } is the base64 of the UTF-8 text (terminal replays).
import fixture from "../Sources/RoveMobile/Demo/demo-fixture.json"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Obj = { [key: string]: Json }

const ops = fixture as Obj

function resolve(value: Json, now: number): Json {
  if (Array.isArray(value)) return value.map((v) => resolve(v, now))
  if (value === null || typeof value !== "object") return value
  const minutes = value.$ago_min ?? value.$in_min
  if (typeof minutes === "number") {
    const at = now + (value.$ago_min === undefined ? 1 : -1) * minutes * 60_000
    return value.$as === "ms" ? at : new Date(at).toISOString()
  }
  if (typeof value.$b64 === "string") return Buffer.from(value.$b64, "utf8").toString("base64")
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, now)]))
}

/** The answer for one request: look the op up, follow `$same_as`, pick by `$by`, resolve times. */
export function answer(op: string, args: Obj = {}, now = Date.now()): Json {
  let entry: Json = ops[op] ?? {}
  if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof entry.$same_as === "string") {
    entry = ops[entry.$same_as] ?? {}
  }
  if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && entry.$by !== undefined) {
    const fields = Array.isArray(entry.$by) ? entry.$by : [entry.$by]
    const key = fields.map((f) => String(args[String(f)] ?? "")).join(":")
    entry = entry[key] ?? entry["*"] ?? {}
  }
  return resolve(entry, now)
}

if (import.meta.main) {
  Bun.serve({
    port: 7896,
    fetch(req, server) {
      if (req.headers.get("authorization") !== "Bearer fixture") return new Response("no", { status: 401 })
      return server.upgrade(req) ? undefined : new Response("ws", { status: 426 })
    },
    websocket: {
      message(ws, raw) {
        const { id, op, args } = JSON.parse(String(raw))
        ws.send(JSON.stringify({ id, ok: true, result: answer(op, args ?? {}) }))
      },
    },
  })
  console.log("fixture bridge on :7896")
}
