import type { DaemonRpcClient } from "@sma1lboy/kobe-daemon/client/rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  ensureHost: vi.fn(),
  openHost: vi.fn(),
  ensureEngine: vi.fn(async () => ({ alive: true, created: true })),
  listSessions: vi.fn(async () => [{ key: "task-3::tab-1", alive: true }]),
  // Same rule as the real resolver for these fixtures: the task's first alive
  // session. What matters here is that it resolves a key from the SPAWN argv
  // and therefore keeps resolving one after the engine is gone.
  findEngineKey: vi.fn(
    (sessions: readonly { key: string; alive?: boolean }[], taskId: string) =>
      sessions.find((s) => s.alive && s.key.startsWith(`${taskId}::`))?.key ?? null,
  ),
  taskKeys: vi.fn(() => ["task-3::tab-1"]),
  killSessions: vi.fn(async () => {}),
  deliver: vi.fn(async () => ({ bytes: 1 })),
  sessionHasEngine: vi.fn(async () => true),
  awaitEngineProcess: vi.fn(async (): Promise<number | null> => 4242),
  failureLine: vi.fn(async () => "⚠ Engine exited (code 127)."),
  buildLaunch: vi.fn((input: { task: { id: string } }): { key: string; command: string[]; firstMessage?: string } => ({
    key: `${input.task.id}::tab-1`,
    command: ["/bin/zsh", "-ilc", "claude 'repo prompt'"],
  })),
}))

vi.mock("../../src/engine/hosted-session.ts", () => ({
  ensureHostedSessionHost: mocks.ensureHost,
  openHostedSessionHost: mocks.openHost,
  ensureHostedEngine: mocks.ensureEngine,
  listHostedSessions: mocks.listSessions,
  findHostedEngineKey: mocks.findEngineKey,
  hostedTaskKeys: mocks.taskKeys,
  killHostedSessions: mocks.killSessions,
  deliverToHostedKey: mocks.deliver,
  awaitEngineProcess: mocks.awaitEngineProcess,
  hostedSessionFailureLine: mocks.failureLine,
}))
vi.mock("../../src/engine/session-launch.ts", () => ({ buildEngineSessionLaunch: mocks.buildLaunch }))
vi.mock("../../src/engine/session-engine-presence.ts", () => ({ sessionHasEngine: mocks.sessionHasEngine }))

import {
  deliverPromptToLiveEngineAdapter,
  deliverPromptToLiveEngineDetailedAdapter,
  deliverPromptToLiveEngineTabDetailedAdapter,
  ensureTaskSessionAdapter,
  startTaskSessionWithPromptAdapter,
  tearDownTaskSessionAdapter,
} from "../../src/core/daemon-session-adapter.ts"

function link(): DaemonRpcClient {
  return {
    request: vi.fn(async <T>(name: string, payload?: unknown): Promise<T> => {
      if (name === "task.get") {
        return {
          task: {
            id: (payload as { taskId: string }).taskId,
            repo: "/repo/kobe",
            kind: "task",
            vendor: "claude",
            worktreePath: "",
          },
        } as T
      }
      if (name === "task.ensureWorktree") return { worktreePath: "/worktrees/story" } as T
      return {} as T
    }),
  } as unknown as DaemonRpcClient
}

describe("daemon session adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const host = { rpc: { request: vi.fn() }, close: mocks.close }
    mocks.ensureHost.mockResolvedValue(host)
    mocks.openHost.mockResolvedValue(host)
  })

  it("materializes the worktree and creates the canonical hosted session", async () => {
    await expect(ensureTaskSessionAdapter(link(), "task-1")).resolves.toEqual({
      session: "task-1::tab-1",
      worktreePath: "/worktrees/story",
    })
    expect(mocks.buildLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ id: "task-1", kind: "task", vendor: "claude" }),
        worktreePath: "/worktrees/story",
        promptIntent: { kind: "repo-init" },
      }),
    )
    expect(mocks.ensureEngine).toHaveBeenCalledWith(expect.anything(), "/worktrees/story", expect.anything())
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it("launches an explicit first prompt as a new-task intent (branch-rename coda)", async () => {
    // Both callers (automation runner, work-item start) create the task
    // immediately ahead of this call, so the first prompt is a new-worktree entry.
    await expect(startTaskSessionWithPromptAdapter(link(), "task-1", "do the thing")).resolves.toEqual({
      started: true,
    })
    expect(mocks.buildLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ promptIntent: { kind: "new-task", prompt: "do the thing" } }),
    )
  })

  // An argv-delivery vendor has nothing left to deliver after the spawn, which
  // is exactly why nothing used to check that the spawn produced an ENGINE:
  // `pty.open` reports the LOGIN SHELL alive, and keepAlive keeps that shell
  // alive when the engine binary does not exist. A routine then recorded
  // `dispatched` forever with a dead task behind every firing.
  it("reports a start only once the engine process is seen, and says why when it isn't", async () => {
    mocks.awaitEngineProcess.mockResolvedValueOnce(null)
    await expect(startTaskSessionWithPromptAdapter(link(), "task-1", "do the thing")).resolves.toEqual({
      started: false,
      error: "engine process never started; last session output: ⚠ Engine exited (code 127).",
    })
    expect(mocks.awaitEngineProcess).toHaveBeenCalled()
  })

  it("tears down a task session best-effort", async () => {
    await tearDownTaskSessionAdapter("task-3")
    expect(mocks.killSessions).toHaveBeenCalledWith(expect.anything(), ["task-3::tab-1"])
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it("reuses materialized worktrees and rejects a failed materialization", async () => {
    const existing = {
      request: vi.fn(
        async <T>() =>
          ({
            task: { id: "task-4", repo: "/repo/kobe", vendor: "claude", worktreePath: "/existing" },
          }) as T,
      ),
    } as unknown as DaemonRpcClient
    await expect(ensureTaskSessionAdapter(existing, "task-4")).resolves.toEqual({
      session: "task-4::tab-1",
      worktreePath: "/existing",
    })
    expect(mocks.ensureEngine).toHaveBeenCalledOnce()

    const missing = {
      request: vi.fn(
        async <T>(name: string) =>
          (name === "task.get"
            ? { task: { id: "task-5", repo: "/repo/kobe", vendor: "claude", worktreePath: "" } }
            : { worktreePath: null }) as T,
      ),
    } as unknown as DaemonRpcClient
    await expect(ensureTaskSessionAdapter(missing, "task-5")).rejects.toThrow("has no worktree")
  })

  it("refuses to materialize a session for a task being deleted", async () => {
    const deleting = {
      request: vi.fn(
        async <T>() =>
          ({
            task: {
              id: "task-6",
              repo: "/repo/kobe",
              vendor: "claude",
              worktreePath: "/worktrees/task-6",
              deletion: { phase: "running", force: false, requestedAt: "2026-07-15T00:00:00.000Z" },
            },
          }) as T,
      ),
    } as unknown as DaemonRpcClient

    await expect(ensureTaskSessionAdapter(deleting, "task-6")).rejects.toThrow("TASK_DELETING")
    expect(mocks.ensureEngine).not.toHaveBeenCalled()
  })

  it("does not paste into an alive PTY after its engine exited to the fallback shell", async () => {
    mocks.listSessions.mockResolvedValueOnce([{ key: "task-3::tab-1", alive: true, pid: 4242 } as never])
    mocks.sessionHasEngine.mockResolvedValueOnce(false)

    await expect(
      deliverPromptToLiveEngineTabDetailedAdapter(
        { id: "task-3", tabId: "tab-1", vendor: "claude", worktreePath: "/worktrees/story" },
        "do not run this in zsh",
      ),
    ).resolves.toEqual({ outcome: "no-engine", tabId: "tab-1" })
    expect(mocks.sessionHasEngine).toHaveBeenCalledWith(4242, expect.arrayContaining(["claude"]))
    expect(mocks.deliver).not.toHaveBeenCalled()
  })

  // The two adapters below resolve their tab by matching the session's SPAWN
  // argv, which keeps matching after the engine exits — keepAlive leaves a
  // login shell in its place. Delivering there does not paste text into an
  // engine, it hands zsh a natural-language instruction to RUN. Both must
  // refuse for the same reason the exact-tab sibling already does.
  it("the routine runner refuses a tab whose engine exited to the fallback shell", async () => {
    mocks.listSessions.mockResolvedValueOnce([{ key: "task-3::tab-1", alive: true, pid: 4242 } as never])
    mocks.sessionHasEngine.mockResolvedValueOnce(false)

    await expect(
      deliverPromptToLiveEngineDetailedAdapter(
        { id: "task-3", vendor: "claude", worktreePath: "/worktrees/story" },
        "clean up the stale branches",
      ),
    ).resolves.toEqual({ outcome: "no-engine", tabId: "tab-1" })
    expect(mocks.deliver).not.toHaveBeenCalled()
  })

  it("the quota-resume runner refuses the same tab", async () => {
    mocks.listSessions.mockResolvedValueOnce([{ key: "task-3::tab-1", alive: true, pid: 4242 } as never])
    mocks.sessionHasEngine.mockResolvedValueOnce(false)

    await expect(
      deliverPromptToLiveEngineAdapter(
        { id: "task-3", vendor: "claude", worktreePath: "/worktrees/story" },
        "continue",
      ),
    ).resolves.toBe(false)
    expect(mocks.deliver).not.toHaveBeenCalled()
  })

  it("a LIVE engine still receives the routine's prompt", async () => {
    mocks.listSessions.mockResolvedValueOnce([{ key: "task-3::tab-1", alive: true, pid: 4242 } as never])

    await expect(
      deliverPromptToLiveEngineDetailedAdapter(
        { id: "task-3", vendor: "claude", worktreePath: "/worktrees/story" },
        "daily report please",
      ),
    ).resolves.toEqual({ outcome: "delivered", tabId: "tab-1" })
    expect(mocks.deliver).toHaveBeenCalled()
  })

  it("passes the custom engine's complete launch argv to the foreground gate", async () => {
    mocks.listSessions.mockResolvedValueOnce([{ key: "task-3::tab-1", alive: true, pid: 4242 } as never])

    await deliverPromptToLiveEngineTabDetailedAdapter(
      {
        id: "task-3",
        tabId: "tab-1",
        command: "env MODEL=sonnet /opt/tools/aider --yes",
        worktreePath: "/worktrees/story",
      },
      "safe prompt",
    )

    expect(mocks.sessionHasEngine).toHaveBeenCalledWith(4242, ["env", "MODEL=sonnet", "/opt/tools/aider", "--yes"])
  })

  it("propagates an ambiguous delivery error after entering the PTY write", async () => {
    mocks.listSessions.mockResolvedValueOnce([{ key: "task-3::tab-1", alive: true, pid: 4242 } as never])
    mocks.deliver.mockRejectedValueOnce(new Error("transport lost after write"))

    await expect(
      deliverPromptToLiveEngineTabDetailedAdapter(
        { id: "task-3", tabId: "tab-1", vendor: "claude", worktreePath: "/worktrees/story" },
        "possibly written",
      ),
    ).rejects.toThrow("transport lost after write")
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
