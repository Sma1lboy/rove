/** @jsxImportSource @opentui/react */
/**
 * The B-layer exit path (issue #78): opening a `prompt_deferred` inbox item
 * jumps AND inserts the queued message, re-running the A/C gate. Render-track
 * proof of the wiring — the inbox half of accept-and-defer.
 *
 * The insert reaches the hosted-PTY boundary; with a sandbox home there is no
 * PTY host socket, so `openHostedSessionHost` fast-fails and the message stays
 * queued (the "unavailable" branch) — exactly what a real headless insert
 * sees. The orchestration above that boundary (fetch record → insert → keep /
 * resolve) is what these tests pin.
 */

import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useEffect } from "react"
import type { AttentionInboxItem, RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import type { KVContext } from "../../src/tui-react/context/kv"
import type { DialogContext } from "../../src/tui-react/ui/dialog"
import { useInboxHost, type useInboxHost as useInboxHostType } from "../../src/tui-react/workspace/use-inbox-host"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

function stubKv(): KVContext {
  const store: Record<string, unknown> = {}
  return {
    ready: true,
    store,
    signal: <T,>(name: string, defaultValue: T) => {
      const read = () => (store[name] ?? defaultValue) as T
      const write = (next: T) => {
        store[name] = next
      }
      return [read, write] as const
    },
    get: (key: string, defaultValue?: unknown) => store[key] ?? defaultValue,
    set: (key: string, value: unknown) => {
      store[key] = value
    },
    flush: () => true,
    clear: () => void 0,
  }
}

function stubDialog(): DialogContext {
  return {
    stack: [],
    replace: () => {},
    push: () => {},
    clear: () => {},
    setSize: () => {},
    setPlacement: () => {},
  } as unknown as DialogContext
}

function task(id: string): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as Task
}

function deferredItem(at: number): AttentionInboxItem {
  return {
    taskId: "task-1",
    tabId: "tab-1",
    state: "prompt_deferred",
    unread: true,
    at,
    detail: { deferredPrompt: { id: "d1", layer: "composer-not-empty" } },
  }
}

interface OrchMock {
  orch: RemoteOrchestrator
  /** Live counter — read `.resolveCalls` after the fact. */
  state: { resolveCalls: number }
  dismissed: Array<{ taskId: string; tabId: string | null; at: number }>
}

function orchMock(over: { deferredRecord?: unknown } = {}): OrchMock {
  const dismissed: Array<{ taskId: string; tabId: string | null; at: number }> = []
  const state = { resolveCalls: 0 }
  const orch = {
    getTask: () => task("task-1"),
    getDeferredPrompt: () => Promise.resolve(over.deferredRecord ?? null),
    resolveDeferredPrompt: () => {
      state.resolveCalls += 1
      return Promise.resolve(true)
    },
    dismissAttention: (taskId: string, tabId: string | null, at: number) => {
      dismissed.push({ taskId, tabId, at })
      return Promise.resolve(true)
    },
  }
  return { orch: orch as unknown as RemoteOrchestrator, state, dismissed }
}

type InboxApi = ReturnType<typeof useInboxHostType>
let inboxApi: InboxApi | null = null
let infoMessages: string[] = []

function InboxProbe(props: { orch: RemoteOrchestrator; items: AttentionInboxItem[] }) {
  const inbox = useInboxHost({
    orchestrator: props.orch,
    items: props.items,
    tasks: [task("task-1")],
    kv: stubKv(),
    dialog: stubDialog(),
    selectedId: null,
    selectTask: () => {},
    focusWorkspace: () => {},
    notifyError: () => {},
    notifyInfo: (message: string) => {
      infoMessages.push(message)
    },
  })
  useEffect(() => {
    inboxApi = inbox
  }, [inbox])
  return null
}

test("opening a prompt_deferred item with no live host keeps it queued (no resolve, no dismiss)", async () => {
  const home = await mkdtemp(join(tmpdir(), "kobe-deferred-exit-"))
  const previous = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = home
  infoMessages = []
  try {
    const { orch, state, dismissed } = orchMock({
      deferredRecord: { id: "d1", taskId: "task-1", tabId: "tab-1", prompt: "hi", layer: "composer-not-empty", at: 1 },
    })
    const { destroy } = await renderComponent(<InboxProbe orch={orch} items={[deferredItem(1)]} />, {
      width: 80,
      height: 24,
    })
    expect(inboxApi).not.toBeNull()
    await act(async () => {
      inboxApi?.openItem(deferredItem(1))
    })
    // Insert reached the hosted-PTY boundary; with no host socket the message
    // stays queued — surfaced via toast, not resolved, not dismissed.
    expect(infoMessages.length).toBeGreaterThan(0)
    expect(state.resolveCalls).toBe(0)
    expect(dismissed).toHaveLength(0)
    destroy()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
    else process.env.KOBE_HOME_DIR = previous
    await rm(home, { recursive: true, force: true })
  }
})

test("opening a prompt_deferred item whose record is gone dismisses the stale episode", async () => {
  const home = await mkdtemp(join(tmpdir(), "kobe-deferred-exit-"))
  const previous = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = home
  infoMessages = []
  try {
    const { orch, dismissed } = orchMock({ deferredRecord: null })
    const { destroy } = await renderComponent(<InboxProbe orch={orch} items={[deferredItem(2)]} />, {
      width: 80,
      height: 24,
    })
    await act(async () => {
      inboxApi?.openItem(deferredItem(2))
    })
    expect(dismissed).toHaveLength(1)
    expect(dismissed[0]?.taskId).toBe("task-1")
    destroy()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
    else process.env.KOBE_HOME_DIR = previous
    await rm(home, { recursive: true, force: true })
  }
})
