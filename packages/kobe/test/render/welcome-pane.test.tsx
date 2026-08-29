/** @jsxImportSource @opentui/react */
/**
 * Real-render coverage for the zero-tasks welcome panel: the live-keymap
 * step lines, the honest environment section (engines found / missing, git
 * missing → doctor hint), and the injected-probe seam that keeps the test
 * off the real PATH.
 */

import { describe, expect, it } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import { type WelcomeEnv, WelcomePane } from "../../src/tui-react/workspace/welcome-pane"
import type { Task } from "../../src/types/task"
import { act, renderComponent } from "./harness"

const probeWith = (env: WelcomeEnv) => () => Promise.resolve(env)

/** Flush the mount-effect probe promise so setEnv lands inside act(). */
const flushProbe = () => act(async () => {})

describe("WelcomePane", () => {
  it("teaches the live keys and lists detected engines", async () => {
    const { frame } = await renderComponent(
      <WelcomePane probe={probeWith({ engines: ["claude", "codex"], git: true })} />,
    )
    await flushProbe()
    const out = await frame()
    expect(out).toContain("Welcome to Rove")
    // Default keymap: task.new = n, help.open = F1 — resolved live, not hardcoded.
    expect(out).toContain("creates your first task")
    expect(out).toContain("shows every shortcut")
    expect(out).toContain("Each task creates its own git worktree")
    expect(out).toContain("claude · codex")
    // Healthy environment → no doctor escalation.
    expect(out).not.toContain("rove doctor")
    expect(out).toContain("docs.rove.run")
  })

  it("is honest when the environment is missing pieces", async () => {
    const { frame } = await renderComponent(<WelcomePane probe={probeWith({ engines: [], git: false })} />)
    await flushProbe()
    const out = await frame()
    expect(out).toContain("no engine CLI found")
    expect(out).toContain("git not found on PATH")
    expect(out).toContain("rove doctor")
  })
})

const NOOP = (): void => {}

function fakeOrchestrator(tasks: Task[]): RemoteOrchestrator {
  return {
    tasksSignal: () => createStateCell<Task[]>(tasks),
    transcriptActivityStore: () => createStateCell(null),
    engineTabStatesSignal: () => createStateCell(new Map()),
  } as unknown as RemoteOrchestrator
}

describe("ShowWorkspace empty state", () => {
  it("keeps the select-a-task line while tasks exist", async () => {
    const { frame } = await renderComponent(
      <ShowWorkspace
        task={undefined}
        worktree={null}
        orchestrator={fakeOrchestrator([{ id: "t1" } as unknown as Task])}
        focused={false}
        onRequestFocus={NOOP}
        onEditorTabReady={NOOP}
        onEngineSendReady={NOOP}
        onDiffTabReady={NOOP}
        onQuickFork={NOOP}
      />,
    )
    const out = await frame()
    expect(out).toContain("Select a task with a worktree")
    expect(out).not.toContain("Welcome to Rove")
  })
})
