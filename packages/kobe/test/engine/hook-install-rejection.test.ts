/**
 * What happens when the hook installer will not touch a settings file.
 *
 * Refusing is right — a best-effort install must never clobber an engine
 * configuration it cannot parse. Refusing SILENTLY was not: a hand-edited
 * `~/.claude/settings.json` whose `hooks` fails the check means Rove stops
 * installing hooks for good, every badge falls back to the daemon's ~10s
 * activity poll, and nothing on the machine names the file. The install
 * abandoned the write through the same `undefined` the loader returns for
 * "nothing to do", so not even the outer catch ran.
 *
 * Pinned here: the reason survives to the caller, exactly ONE tagged line is
 * written, and a legal file still installs in silence (the negative control —
 * without it this only proves the code got louder).
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodexHookAdapter } from "../../src/engine/codex-local/hook-adapter.ts"
import { parseHookSettings } from "../../src/engine/json-hooks.ts"

vi.mock("../../src/cli/invocation.ts", () => ({
  roveCliInvocation: () => ["rove"],
  kobeHookInvocation: () => ["rove"],
}))

describe("parseHookSettings", () => {
  it("treats a missing file as an empty document, not a refusal", () => {
    expect(parseHookSettings(undefined)).toEqual({ ok: true, doc: {} })
  })

  it("accepts a document with no hooks key and a well-formed one", () => {
    expect(parseHookSettings('{"model":"opus"}')).toEqual({ ok: true, doc: { model: "opus" } })
    const ok = parseHookSettings('{"hooks":{"PreToolUse":[{"hooks":[]}]}}')
    expect(ok.ok).toBe(true)
  })

  it("names what it refused, down to the offending group index", () => {
    expect(parseHookSettings("{oops")).toMatchObject({ ok: false })
    expect(parseHookSettings("[]")).toEqual({ ok: false, reason: "top level is not a JSON object" })
    expect(parseHookSettings('{"hooks":[]}')).toEqual({ ok: false, reason: '"hooks" is not an object' })
    expect(parseHookSettings('{"hooks":{"PreToolUse":"not-an-array"}}')).toEqual({
      ok: false,
      reason: '"hooks.PreToolUse" is not an array',
    })
    expect(parseHookSettings('{"hooks":{"Stop":[{"hooks":[]},{"matcher":"x"}]}}')).toEqual({
      ok: false,
      reason: '"hooks.Stop[1]" is not an object with a "hooks" array',
    })
  })
})

describe("installActivityHooks on a settings file it cannot parse", () => {
  let dir: string
  let file: string
  let stderr: MockInstance<typeof process.stderr.write>
  const adapter = new CodexHookAdapter()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rove-hook-reject-"))
    file = join(dir, "hooks.json")
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
  })

  afterEach(async () => {
    stderr.mockRestore()
    await rm(dir, { recursive: true, force: true })
  })

  const written = (): string => stderr.mock.calls.map((call) => String(call[0])).join("")

  it("returns the reason, says it once, and leaves the file untouched", async () => {
    const before = '{"hooks":{"PreToolUse":"not-an-array"}}'
    await writeFile(file, before, "utf8")

    const outcome = await adapter.installActivityHooks(file)

    expect(outcome).toEqual({ ok: false, file, reason: '"hooks.PreToolUse" is not an array' })
    expect(await readFile(file, "utf8")).toBe(before)
    const lines = written().trimEnd().split("\n")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("[rove hooks]")
    expect(lines[0]).toContain(file)
    expect(lines[0]).toContain('"hooks.PreToolUse" is not an array')
  })

  it("negative control: a legal settings file still installs, and says nothing", async () => {
    await writeFile(file, '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[]}]}}', "utf8")

    expect(await adapter.installActivityHooks(file)).toEqual({ ok: true })

    expect(written()).toBe("")
    // The user's own group survived and Rove's hooks landed beside it.
    const doc = JSON.parse(await readFile(file, "utf8")) as { hooks: Record<string, unknown[]> }
    expect(doc.hooks.PreToolUse).toContainEqual({ matcher: "Bash", hooks: [] })
    expect(JSON.stringify(doc)).toContain("'rove' 'hook'")
  })

  it("negative control: a missing file is a first launch, not a refusal", async () => {
    expect(await adapter.installActivityHooks(join(dir, "absent", "hooks.json"))).toEqual({ ok: true })
    expect(written()).toBe("")
  })
})
