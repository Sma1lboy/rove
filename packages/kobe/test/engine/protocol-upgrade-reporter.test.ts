/**
 * Tier-(b) protocol sniff CONSUMER (issue #31) — the observer→record chain
 * that upgrades a `generic` task from its live session. Two layers under
 * test with the real naming rule (`protocolUpgradeFromLiveSession`) plugged
 * in end-to-end:
 *
 *   - the reporter (`createProtocolUpgradeReporter`): only `tab-1` speaks
 *     for the record — a claude the user starts BY HAND in another tab must
 *     never rename the task's protocol.
 *   - the observer relay: a walked live session's evidence reaches the
 *     reporter and lands as ONE `setCommand` whose command is unchanged —
 *     the upgrade is metadata (protocol), never a different launch.
 *
 * The refusal matrix itself (wrong-upgrade conservatism) lives in
 * `protocol-sniff.test.ts`; here the stake is the wiring.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startActivityObserver } from "@sma1lboy/kobe-daemon/daemon/activity-observer"
import { DaemonActivityRegistry } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { createProtocolUpgradeReporter } from "@sma1lboy/kobe-daemon/daemon/collectors"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { protocolUpgradeFromLiveSession } from "../../src/engine/protocol-sniff.ts"
import { engineTitleTurnHint } from "../../src/engine/registry.ts"

let home: string
let originalHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kobe-protocol-upgrade-"))
  originalHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = home
  const dir = join(home, ".config", "rove")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "state.json"), "{}", "utf8")
})

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  if (originalHome === undefined) {
    // biome-ignore lint/performance/noDelete: the var must be truly unset when it started unset.
    delete process.env.KOBE_HOME_DIR
  } else process.env.KOBE_HOME_DIR = originalHome
  rmSync(home, { recursive: true, force: true })
})

const cleanups: Array<() => void> = []

/** Minimal in-memory task store shaped like the reporter's orch slice. */
function fakeOrch(initial: { vendor?: string; command?: string }) {
  const tasks = new Map<string, { vendor?: string; command?: string }>([["task-1", { ...initial }]])
  const setCommandCalls: Array<{ id: string; command: string; vendor?: string }> = []
  return {
    tasks,
    setCommandCalls,
    getTask: (id: string) => tasks.get(id) as never,
    setCommand: (id: string, command: string, vendor?: string) => {
      setCommandCalls.push({ id, command, ...(vendor ? { vendor } : {}) })
      const prev = tasks.get(id)
      if (prev) tasks.set(id, { ...prev, command, ...(vendor ? { vendor } : {}) })
      return Promise.resolve()
    },
  }
}

const runtime = { resolveProtocolUpgrade: protocolUpgradeFromLiveSession }

describe("createProtocolUpgradeReporter", () => {
  it("upgrades a generic task's protocol from tab-1 evidence, keeping its command", async () => {
    const orch = fakeOrch({ vendor: "generic", command: "my-wrapper.sh" })
    const report = createProtocolUpgradeReporter(orch as never, runtime as never)
    report("task-1", "tab-1", { walkVendor: "claude", title: "⠂ working" })
    await Promise.resolve()
    expect(orch.setCommandCalls).toEqual([{ id: "task-1", command: "my-wrapper.sh", vendor: "claude" }])
    // Idempotent: the upgraded record is no longer generic, so the next
    // tick's identical evidence resolves to no write at all.
    report("task-1", "tab-1", { walkVendor: "claude", title: "⠂ working" })
    await Promise.resolve()
    expect(orch.setCommandCalls).toHaveLength(1)
  })

  it("ignores an engine running in any tab but tab-1", async () => {
    // A claude the user launched by hand in a secondary tab (or a
    // cross-vendor `send --tab tab-2`) says nothing about the task's own
    // command — the record must stay generic.
    const orch = fakeOrch({ vendor: "generic", command: "my-wrapper.sh" })
    const report = createProtocolUpgradeReporter(orch as never, runtime as never)
    report("task-1", "tab-3", { walkVendor: "claude", title: "✳ hand-started" })
    await Promise.resolve()
    expect(orch.setCommandCalls).toEqual([])
  })

  it("ignores evidence for a task the store no longer has", () => {
    const orch = fakeOrch({ vendor: "generic", command: "my-wrapper.sh" })
    const report = createProtocolUpgradeReporter(orch as never, runtime as never)
    expect(() => report("task-gone", "tab-1", { walkVendor: "claude", title: "⠂ x" })).not.toThrow()
    expect(orch.setCommandCalls).toEqual([])
  })

  it("never upgrades when the runtime ships no resolver", () => {
    const orch = fakeOrch({ vendor: "generic", command: "my-wrapper.sh" })
    const report = createProtocolUpgradeReporter(orch as never, {} as never)
    report("task-1", "tab-1", { walkVendor: "claude", title: "⠂ x" })
    expect(orch.setCommandCalls).toEqual([])
  })
})

describe("observer → reporter relay", () => {
  const waitFor = async (cond: () => boolean, timeoutMs = 1500): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (!cond()) {
      if (Date.now() > deadline) throw new Error("condition not met in time")
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  function observe(
    orch: ReturnType<typeof fakeOrch>,
    sessions: Array<{ key: string; pid: number; title: string }>,
    engines: Map<number, string | null>,
  ) {
    const bus = new DaemonEventBus()
    const registry = new DaemonActivityRegistry(bus)
    const stop = startActivityObserver(
      registry,
      {
        listSessions: () =>
          Promise.resolve(
            sessions.map((s) => ({ key: s.key, alive: true, pid: s.pid, title: s.title, totalBytes: 1 })),
          ),
        foregroundEngines: (pids) => {
          const out = new Map<number, string | null>()
          for (const pid of pids) out.set(pid, engines.get(pid) ?? null)
          return Promise.resolve(out)
        },
        titleTurnHint: engineTitleTurnHint,
        onEngineEvidence: createProtocolUpgradeReporter(orch as never, runtime as never),
      },
      () => true,
      { pollMs: 15, silenceMs: 60, walkEveryTicks: 2, log: () => {} },
    )
    cleanups.push(stop, () => registry.close())
  }

  it("a generic task whose live tab-1 walks to claude gets its record upgraded", async () => {
    const orch = fakeOrch({ vendor: "generic", command: "my-wrapper.sh" })
    observe(orch, [{ key: "task-1::tab-1", pid: 42, title: "⠂ 修复构建" }], new Map([[42, "claude"]]))
    await waitFor(() => orch.tasks.get("task-1")?.vendor === "claude")
    expect(orch.tasks.get("task-1")).toEqual({ vendor: "claude", command: "my-wrapper.sh" })
  })

  it("a renamed binary that only its title vocabulary identifies still upgrades", async () => {
    // The walk answers null ("no engine word in the tree"); the OSC title's
    // claude-unique glyph is the remaining fingerprint.
    const orch = fakeOrch({ vendor: "generic", command: "cc-switch" })
    observe(orch, [{ key: "task-1::tab-1", pid: 42, title: "✳ waiting for input" }], new Map([[42, null]]))
    await waitFor(() => orch.tasks.get("task-1")?.vendor === "claude")
    expect(orch.setCommandCalls).toEqual([{ id: "task-1", command: "cc-switch", vendor: "claude" }])
  })

  it("an undecorated generic session stays generic — no upgrade, ever", async () => {
    const orch = fakeOrch({ vendor: "generic", command: "my-repl" })
    observe(orch, [{ key: "task-1::tab-1", pid: 42, title: "my-repl" }], new Map([[42, null]]))
    // Let several observe ticks (and a walk) pass, then assert nothing wrote.
    await new Promise((r) => setTimeout(r, 120))
    expect(orch.setCommandCalls).toEqual([])
    expect(orch.tasks.get("task-1")?.vendor).toBe("generic")
  })
})
