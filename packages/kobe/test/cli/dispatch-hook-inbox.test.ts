import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DaemonActivityRegistry } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { AttentionInboxStore } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import type { PtyChild, PtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-driver"
import { PtyHost } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { createDaemonHandlerRegistry, dispatchDaemonRequest } from "@sma1lboy/kobe-daemon/daemon/server"
import { expect, it, vi } from "vitest"
import {
  type PtyClientState,
  type PtyRequest,
  dispatchPtyRequest,
} from "../../../kobe-daemon/src/daemon/pty-server-verbs"

const bridge = vi.hoisted(() => ({
  daemon: async (_name: string, _payload?: unknown): Promise<unknown> => {
    throw new Error("not connected")
  },
  pty: async (_name: string, _payload?: unknown): Promise<unknown> => {
    throw new Error("not connected")
  },
}))
vi.mock("@sma1lboy/kobe-daemon/client/daemon-process", async (original) => ({
  ...(await original<object>()),
  connectIfRunning: async () => ({ request: bridge.daemon, close() {} }),
}))
vi.mock("../../src/engine/hosted-session.ts", async (original) => ({
  ...(await original<object>()),
  openHostedSessionHost: async () => ({ rpc: { request: bridge.pty }, close() {} }),
  ensureHostedSessionHost: async () => ({ rpc: { request: bridge.pty }, close() {} }),
}))
// A simulated provider has no OS process tree. All delivery and hook code remains real.
vi.mock("../../src/engine/session-engine-presence.ts", () => ({
  enginePresence: async () => ({ kind: "engine", vendor: "codex" }),
}))

import { invokeVerb } from "../../src/cli/api-cmd"
import type { DaemonRpc } from "../../src/cli/daemon-session"
import { runHookSubcommand } from "../../src/cli/hook-cmd"
import { Orchestrator } from "../../src/orchestrator/core"
import { TaskIndexStore } from "../../src/orchestrator/index/store"
import { GitWorktreeManager } from "../../src/orchestrator/worktree/manager"
import { fakeCtx } from "../daemon/handler-test-context"

class SimulatedProvider implements PtyChild {
  readonly input: string[] = []
  readonly exited: Promise<PtyExit>
  private finish: (exit: PtyExit) => void = () => {}
  constructor(
    readonly pid: number,
    readonly emit: (text: string) => void,
  ) {
    this.exited = new Promise((resolve) => {
      this.finish = resolve
    })
  }
  write(text: string) {
    this.input.push(text)
    this.emit(text)
  }
  resize() {}
  close() {}
  kill() {
    this.finish({ code: 0, signal: null })
  }
}

it("routes repository tasks through real dispatch, hosted paste, hook normalization and durable Inbox", async () => {
  const root = mkdtempSync(join(tmpdir(), "rove-dispatch-hook-"))
  const home = join(root, "home")
  const repo = join(root, "repo")
  const init = spawnSync("bash", [resolve(__dirname, "../orchestrator/fixtures/repo-init.sh"), repo], {
    encoding: "utf8",
  })
  expect(init.status, init.stderr).toBe(0)
  for (const key of ["HOME", "ROVE_HOME_DIR", "KOBE_HOME_DIR", "CODEX_HOME"]) vi.stubEnv(key, home)
  vi.stubEnv("KOBE_TASK_ID", "")
  vi.stubEnv("ROVE_TASK_ID", "")
  vi.stubEnv("KOBE_TAB_ID", "")
  vi.stubGlobal("Bun", { stdin: { text: async () => "" } })
  const store = new TaskIndexStore({ homeDir: home })
  await store.load()
  const orch = new Orchestrator({ store, worktrees: new GitWorktreeManager() })
  const bus = new DaemonEventBus()
  const activity = new DaemonActivityRegistry(bus, 60000, Date.now, undefined, (id) => Boolean(orch.getTask(id)))
  const inboxPath = join(home, ".rove", "attention-inbox.json")
  const inbox = new AttentionInboxStore(inboxPath, bus)
  await inbox.init()
  const children: SimulatedProvider[] = []
  const host = new PtyHost({
    driver: (request) => {
      const child = new SimulatedProvider(40000 + children.length, (text) => request.onData(text))
      children.push(child)
      return child
    },
  })
  const clientState = {} as PtyClientState // No socket field is read by the in-process verb handler.
  const ctx = { ...fakeCtx().ctx, orch, bus, activity, inbox }
  const registry = createDaemonHandlerRegistry()
  bridge.daemon = async (name, payload) => {
    return dispatchDaemonRequest(registry, name, payload, ctx)
  }
  bridge.pty = async (name, payload) => {
    const req = { type: "request", id: "test-request", name, payload } as PtyRequest
    return dispatchPtyRequest(req, clientState, { ptys: host, writeFrame() {}, requestStop() {} })
  }
  const client: DaemonRpc = {
    request: async <T>(name: string, payload?: unknown) => (await bridge.daemon(name, payload)) as T,
    subscribe: async () => ({}),
    onChannel: () => () => {},
  }
  try {
    const a = (await invokeVerb("add", ["--repo", repo, "--title", "Dispatch A", "--command", "codex"], {
      client,
    })) as { taskId: string }
    const b = (await invokeVerb("add", ["--repo", repo, "--title", "Dispatch B", "--command", "codex"], {
      client,
    })) as { taskId: string }
    for (const taskId of [a.taskId, b.taskId]) await invokeVerb("ensure-worktree", ["--task-id", taskId], { client })
    const pathA = orch.getTask(a.taskId)?.worktreePath
    const pathB = orch.getTask(b.taskId)?.worktreePath
    expect(pathA).toBeTruthy()
    expect(pathB).toBeTruthy()
    expect(pathA).not.toBe(pathB)
    const missing = await invokeVerb("dispatch", ["--task-id", a.taskId, "--tab", "tab-1", "--prompt", "NO RECEIVER"], {
      client,
    })
    expect(missing).toMatchObject({ delivered: false, reason: "broadcast" })
    expect(children).toHaveLength(0)
    for (const taskId of [a.taskId, b.taskId]) {
      await bridge.pty("pty.open", {
        key: `${taskId}::tab-1`,
        cwd: orch.getTask(taskId)?.worktreePath,
        command: ["codex"],
        answersQueries: true,
      })
      children[children.length - 1]?.emit("\x1b[?2004h")
    }
    const prompt = "Inspect this task only. Reply DISPATCH_A_OK."
    const delivered = await invokeVerb("dispatch", ["--task-id", a.taskId, "--tab", "tab-1", "--prompt", prompt], {
      client,
    })
    expect(delivered).toMatchObject({ delivered: true, tabId: "tab-1" })
    expect(children[0]?.input.join("")).toContain(prompt)
    expect(children[0]?.input.at(-1)).toContain("\r")
    expect(children[1]?.input.join("")).not.toContain(prompt)
    vi.stubEnv("KOBE_TAB_ID", "tab-1")
    vi.stubEnv("KOBE_TASK_ID", a.taskId)
    const hookPayload = JSON.stringify({ cwd: pathA, session_id: "fixture-session-a", transcript_path: null })
    for (const kind of ["session-start", "turn-start", "turn-complete"]) {
      await runHookSubcommand([kind, "--engine", "codex", "--payload", hookPayload])
    }
    expect(activity.debugSnapshot().tabs[a.taskId]?.["tab-1"]?.state).toBe("turn_complete")
    expect(inbox.snapshot()).toMatchObject([{ taskId: a.taskId, tabId: "tab-1", state: "turn_complete" }])
    expect(activity.debugSnapshot().tabs[b.taskId]).toBeUndefined()
    const replay = activity.replaySnapshot().find((e) => e.taskId === a.taskId && e.tabId === "tab-1")
    expect(replay?.sessionId).toBe("fixture-session-a")
    const restoredInbox = new AttentionInboxStore(inboxPath, new DaemonEventBus())
    await restoredInbox.init()
    expect(restoredInbox.snapshot()).toEqual(inbox.snapshot())
    expect(JSON.parse(readFileSync(inboxPath, "utf8")).items).toHaveLength(1)
    vi.stubEnv("KOBE_TASK_ID", "")
    const hookB = JSON.stringify({ cwd: pathB, session_id: "fixture-session-b", transcript_path: null })
    await runHookSubcommand(["turn-start", "--engine", "codex", "--payload", hookB])
    expect(activity.debugSnapshot().tabs[b.taskId]?.["tab-1"]?.state).toBe("running")
    expect(activity.debugSnapshot().tabs[a.taskId]?.["tab-1"]?.state).toBe("turn_complete")
    expect(inbox.snapshot()).toHaveLength(1)
    vi.stubEnv("KOBE_TASK_ID", a.taskId)
    await runHookSubcommand(["turn-start", "--engine", "codex", "--payload", hookPayload])
    expect(inbox.snapshot()).toEqual([])
    expect(activity.debugSnapshot().tabs[a.taskId]?.["tab-1"]?.state).toBe("running")
  } finally {
    activity.close()
    orch.dispose()
    await host.killAll()
    rmSync(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
}, 20000)
