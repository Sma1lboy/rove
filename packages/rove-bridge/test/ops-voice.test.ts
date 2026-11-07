import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Server } from "bun"
import type { BridgeApi } from "../src/ops/types.ts"
import { voiceOps } from "../src/ops/voice.ts"

/** A stand-in sidecar: answers every transcription and keeps the body the op sent. */
let sent: Record<string, unknown> | null = null
let server: Server<undefined>
const saved = { home: process.env.ROVE_VOICE_HOME, port: process.env.ROVE_VOICE_PORT }

beforeAll(() => {
  const home = mkdtempSync(join(tmpdir(), "voice-op-"))
  writeFileSync(join(home, "token"), "secret")
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      sent = (await req.json()) as Record<string, unknown>
      return Response.json({ text: "heard", raw: "heard", language: "zh", seconds: 1, ms: 5 })
    },
  })
  process.env.ROVE_VOICE_HOME = home
  process.env.ROVE_VOICE_PORT = String(server.port)
})

afterAll(() => {
  server.stop(true)
  process.env.ROVE_VOICE_HOME = saved.home
  process.env.ROVE_VOICE_PORT = saved.port
})

beforeEach(() => {
  sent = null
})

const api = (verb: BridgeApi["verb"]): BridgeApi => ({ verb, rpc: async () => ({}) as never })
const transcribe = (verb: BridgeApi["verb"]) =>
  voiceOps["voice.transcribe"]?.run({ wav: "00", taskId: "t1", tabId: "tab-1", context: "draft" }, { api: api(verb) })

test("the conversation's text and tool inputs reach the sidecar as vocabulary", async () => {
  const reply = {
    history: {
      messages: [
        { blocks: [{ type: "text", text: "rename useEffect in term-composer.tsx" }] },
        { blocks: [{ type: "tool_use", name: "Bash", input: { command: "bun run pre-pr" } }] },
      ],
    },
  }
  await transcribe(async () => reply as never)
  expect(sent?.conversation).toBe('rename useEffect in term-composer.tsx\n{"command":"bun run pre-pr"}')
  expect(sent?.context).toBe("draft")
})

test("a transcript read that fails or hangs never holds the dictation up", async () => {
  expect(await transcribe(async () => Promise.reject(new Error("no task")))).toMatchObject({ text: "heard" })
  expect(sent?.conversation).toBeUndefined()

  const started = Date.now()
  expect(await transcribe(() => new Promise<never>(() => {}))).toMatchObject({ text: "heard" })
  expect(sent?.conversation).toBeUndefined()
  expect(Date.now() - started).toBeLessThan(3000)
})
