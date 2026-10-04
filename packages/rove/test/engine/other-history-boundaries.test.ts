import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { fetchClaudeQuotaUsage } from "../../src/engine/claude-code-local/quota"
import { usageFromRolloutRaw } from "../../src/engine/codex-local/quota"
import { MAX_JSONL_LINE_CHARS } from "../../src/engine/file-bounds"
import { parseSessionIndex } from "../../src/engine/kimi-local/history"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it("rejects malformed Kimi field types and oversized index lines", () => {
  expect(parseSessionIndex('{"sessionId":1,"sessionDir":true,"workDir":"/wt"}')).toEqual([])
  const valid = { sessionId: "s", sessionDir: "/dir", workDir: "/wt" }
  const huge = JSON.stringify({ ...valid, padding: "x".repeat(MAX_JSONL_LINE_CHARS) })
  expect(parseSessionIndex(`${huge}\n${JSON.stringify(valid)}`)).toEqual([valid])
})

it("skips oversized Codex quota records", () => {
  const record = { payload: { rate_limits: { primary: { used_percent: 10, window_minutes: 300, resets_at: 1000 } } } }
  const huge = JSON.stringify({ ...record, padding: "x".repeat(MAX_JSONL_LINE_CHARS) })
  expect(usageFromRolloutRaw(huge, 0)).toBeNull()
  expect(usageFromRolloutRaw(`${JSON.stringify(record)}\n${huge}`, 0)?.windows[0]?.percent).toBe(10)
})

it("refuses oversized Claude file credentials without making a request", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rove-quota-bounds-"))
  const dir = path.join(root, "claude")
  await mkdir(dir)
  const file = path.join(dir, ".credentials.json")
  await writeFile(file, '{"claudeAiOauth":{"accessToken":"fixture-token"}}')
  const handle = await open(file, "r+")
  await handle.truncate(100 * 1024 * 1024 + 1)
  await handle.close()
  vi.stubEnv("CLAUDE_CONFIG_DIR", dir)
  const fetch = vi.fn()
  vi.stubGlobal("fetch", fetch)
  expect(await fetchClaudeQuotaUsage()).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})
