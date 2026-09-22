/**
 * The read side of engine integration status: is what is on disk the shape
 * THIS Rove writes, an older one, or nothing at all.
 *
 * The three-way verdict is the whole point — before the version stamp the
 * only readable states were "there" and "not there", so a settings file
 * written by an older Rove reported as healthy forever. The live half (write
 * an old entry → outdated → install → installed) runs the REAL Claude
 * adapter against a temp settings file, because an outdated→installed
 * transition that a hand-written fixture "proves" is exactly the write-path
 * bug a fixture cannot see.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ClaudeHookAdapter } from "@/engine/claude-code-local/hook-adapter"
import { CLAUDE_HOOK_EVENT_MAP } from "@/engine/claude-code-local/hook-adapter"
import { mergeCursorHooks } from "@/engine/cursor-local/hook-adapter"
import { engineIntegrations, readHookInstallState } from "@/engine/integration-status"
import { ROVE_HOOK_VERSION, buildActivityHooks, mergeActivityHooks, roveHookArgs } from "@/engine/json-hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/cli/invocation.ts", () => ({
  roveCliInvocation: () => ["rove"],
  kobeHookInvocation: () => ["rove"],
}))

describe("readHookInstallState", () => {
  it("calls an entry stamped with an older version outdated", () => {
    const text = `command = "rove hook turn-complete --engine kimi --hook-version ${ROVE_HOOK_VERSION - 1}"`
    expect(readHookInstallState(text)).toBe("outdated")
  })

  it("calls an UNSTAMPED entry outdated, not installed", () => {
    // Every install written before the stamp existed looks like this. Reading
    // it as `installed` is the blind spot the stamp was added to close.
    expect(readHookInstallState(`"command": "rove hook turn-complete --engine claude"`)).toBe("outdated")
    // Older still: no --engine tag either.
    expect(readHookInstallState(`"command": "kobe hook turn-complete"`)).toBe("outdated")
  })

  it("calls a file with one stale entry among current ones outdated", () => {
    // The installer rewrites its whole group, so a mixed file is mid-upgrade.
    const text = [
      `rove hook turn-complete --engine claude --hook-version ${ROVE_HOOK_VERSION}`,
      "rove hook turn-start --engine claude",
    ].join("\n")
    expect(readHookInstallState(text)).toBe("outdated")
  })

  it("calls a file with no Rove hook at all not-installed", () => {
    expect(readHookInstallState(JSON.stringify({ hooks: { Stop: [] }, model: "opus" }))).toBe("not-installed")
    expect(readHookInstallState("")).toBe("not-installed")
  })

  it("reads the pi-family extension's own stamp, and its unstamped ancestor", () => {
    // That module builds its argv at runtime, so a header line is the only
    // thing in the bytes that can carry a version.
    expect(readHookInstallState(`/**\n * ROVE_HOOK_VERSION=${ROVE_HOOK_VERSION}\n */`)).toBe("installed")
    expect(readHookInstallState(`/**\n * ROVE_HOOK_VERSION=${ROVE_HOOK_VERSION - 1}\n */`)).toBe("outdated")
    expect(readHookInstallState("/**\n * Rove activity hook — GENERATED\n */")).toBe("outdated")
  })

  it("ignores a user's own command that merely mentions a hook", () => {
    expect(readHookInstallState(`"command": "make hooks && echo turn-complete"`)).toBe("not-installed")
  })
})

describe("the installed shape carries the stamp", () => {
  it("every built command names the engine and the version", () => {
    const built = buildActivityHooks(CLAUDE_HOOK_EVENT_MAP, ["rove"], { extraArgs: roveHookArgs("claude") })
    const commands = Object.values(built).flatMap((groups) =>
      (groups as { hooks: { command: string }[] }[]).flatMap((group) => group.hooks.map((h) => h.command)),
    )
    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(command).toContain("--engine claude")
      expect(command).toContain(`--hook-version ${ROVE_HOOK_VERSION}`)
    }
  })

  it("replaces an UNSTAMPED entry rather than installing a second one", () => {
    // Ownership has to survive the flag change, or an upgrade would leave the
    // legacy command in place and fire every hook twice.
    const legacy = {
      hooks: { Stop: [{ hooks: [{ type: "command", command: "rove hook turn-complete --engine claude" }] }] },
    }
    const merged = mergeActivityHooks(legacy, true, CLAUDE_HOOK_EVENT_MAP, ["rove"], {
      extraArgs: roveHookArgs("claude"),
    })
    const stop = (merged.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop
    expect(stop).toHaveLength(1)
    expect(stop[0]?.hooks[0]?.command).toContain(`--hook-version ${ROVE_HOOK_VERSION}`)
  })

  it("a SECOND install replaces its own stamped entry instead of stacking a duplicate", () => {
    // The installer runs on every launch, so ownership has to survive the
    // flags it just wrote. A predicate that recognizes only the legacy
    // `--engine <id>` tail passes the upgrade test above and then appends a
    // fresh copy on every subsequent launch — every hook firing twice.
    const opts = { extraArgs: roveHookArgs("claude") }
    const once = mergeActivityHooks({}, true, CLAUDE_HOOK_EVENT_MAP, ["rove"], opts)
    const twice = mergeActivityHooks(once, true, CLAUDE_HOOK_EVENT_MAP, ["rove"], opts)
    const stop = (twice.hooks as Record<string, { hooks: { command: string }[] }[]>).Stop
    expect(stop).toHaveLength(1)
    expect(stop[0]?.hooks).toHaveLength(1)
    expect(twice).toEqual(once)
  })
})

describe("a contrib engine that declares a hook adapter", () => {
  it("reports hooks on cursor's row, not the screen-only shape of the rest of the catalog", () => {
    // The shared acceptance point of the hook-version work and the
    // contrib-adapter work: the panel derives its rows from the engine list,
    // so cursor gaining an adapter has to light up here with no edit to the
    // panel. `amp` is the control — same catalog, no adapter.
    const [cursor, amp] = engineIntegrations(["cursor", "amp"])
    expect(cursor?.hooksSupported).toBe(true)
    expect(cursor?.hookFile).toContain("hooks.json")
    expect(cursor?.screen).toBe(true) // the adapter does NOT replace its manifest
    expect(amp?.hooksSupported).toBe(false)
    expect(amp?.screen).toBe(true)
  })

  it("stamps its install so the panel can age it like any other engine", () => {
    const installed = mergeCursorHooks({}, true, ["rove"])
    const text = JSON.stringify(installed)
    expect(readHookInstallState(text)).toBe("installed")
    expect(readHookInstallState(text.replaceAll(/ --hook-version \d+/g, ""))).toBe("outdated")
  })
})

describe("outdated → install → installed, through the real adapter", () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rove-hookver-"))
    file = join(dir, "settings.json")
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("reads an old install as outdated, then as installed once the adapter rewrites it", async () => {
    await writeFile(
      file,
      `${JSON.stringify(
        {
          model: "opus",
          hooks: { Stop: [{ hooks: [{ type: "command", command: "rove hook turn-complete --engine claude" }] }] },
        },
        null,
        2,
      )}\n`,
    )
    expect(readHookInstallState(await readFile(file, "utf8"))).toBe("outdated")

    const outcome = await new ClaudeHookAdapter().installActivityHooks(file)
    expect(outcome.ok).toBe(true)

    const after = await readFile(file, "utf8")
    expect(readHookInstallState(after)).toBe("installed")
    // The unrelated key survives the rewrite — this writes a SHARED file.
    expect(JSON.parse(after).model).toBe("opus")
  })

  it("a refused install prints to stderr at launch, and not a byte when quiet", async () => {
    // The Settings row runs this installer under a live OpenTUI render, where
    // a raw stderr write paints over the frame — a real one showed up in the
    // harness still. The launch path must keep printing: that line is where
    // `rove doctor` sends a reader whose hook channel is dead.
    await writeFile(file, `${JSON.stringify({ hooks: [] })}\n`)
    const written: string[] = []
    const real = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await new ClaudeHookAdapter().installActivityHooks(file, { quiet: true })
      expect(written).toEqual([])
      await new ClaudeHookAdapter().installActivityHooks(file)
      expect(written.join("")).toContain("skipped")
    } finally {
      process.stderr.write = real
    }
  })
})
