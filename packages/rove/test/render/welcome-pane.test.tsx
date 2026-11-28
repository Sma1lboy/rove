/** @jsxImportSource @opentui/react */
/**
 * Real-render coverage for the zero-tasks welcome panel: the live-keymap
 * step lines, the honest environment section (engines found / missing, git
 * missing → doctor hint), and the injected-probe seam that keeps the test
 * off the real PATH.
 */

import { describe, expect, it } from "bun:test"
import type { RemoteOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import { createStateCell } from "@sma1lboy/rove-core/lib/external-store.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { FocusProvider } from "../../src/tui-react/context/focus"
import { ShowWorkspace } from "../../src/tui-react/workspace/show-workspace"
import { type WelcomeEnv, WelcomePane } from "../../src/tui-react/workspace/welcome-pane"
import { act, renderComponent } from "./harness"

const probeWith = (env: WelcomeEnv) => () => Promise.resolve(env)

/** Flush the mount-effect probe promise so setEnv lands inside act(). */
const flushProbe = () => act(async () => {})

describe("WelcomePane", () => {
  it("teaches the live keys and lists detected engines", async () => {
    const { frame } = await renderComponent(
      <WelcomePane probe={probeWith({ engines: ["claude", "codex"], signedOut: [], git: true })} />,
    )
    await flushProbe()
    const out = await frame()
    expect(out).toContain("Welcome to Rove")
    // Default keymap: task.new = n, help.open = F1 — resolved live, not hardcoded.
    expect(out).toContain("creates your first task")
    expect(out).toContain("shows every shortcut")
    expect(out).toContain("Managed tasks create isolated worktrees")
    expect(out.replace(/\s+/g, " ")).toContain("Directory and project tasks reuse existing files")
    expect(out).toContain("Claude · Codex")
    // Healthy environment → no doctor escalation.
    expect(out).not.toContain("rove doctor")
    expect(out).toContain("docs.rove.run")
  })

  it("teaches the prefix chord for a new task when the sidebar is not focused", async () => {
    // task.new (`n`) only fires on the sidebar; off it, `n` is dropped or typed.
    const env = probeWith({ engines: ["claude"], signedOut: [], git: true })
    const render = async (initial: "workspace" | "sidebar") => {
      // Narrow enough that the longer prefix cap wraps its row onto two lines.
      const { frame } = await renderComponent(
        <FocusProvider initial={initial}>
          <WelcomePane probe={env} />
        </FocusProvider>,
        { width: 72, height: 30 },
      )
      await flushProbe()
      const lines = (await frame()).split("\n").map((line) => line.trim())
      return { stepNew: lines.find((line) => line.includes("creates your first task")), lines }
    }
    const workspace = await render("workspace")
    expect(workspace.stepNew).toMatch(/^⌃ A n\s+creates your first task/)
    // The wrapped row must not squeeze the rows below it out of the column.
    expect(workspace.lines.some((line) => line.startsWith("F1"))).toBe(true)
    expect(workspace.lines[workspace.lines.findIndex((line) => line.startsWith("Managed tasks")) - 1]).toBe("")
    expect((await render("sidebar")).stepNew).toMatch(/^n\s+creates your first task/)
  })

  it("says installed-but-logged-out rather than a bare ✓", async () => {
    // The likely new-user machine: every CLI present, none signed in. This
    // used to take the ✓ branch, contradicting the wizard on the same home.
    const { frame } = await renderComponent(
      <WelcomePane probe={probeWith({ engines: [], signedOut: ["claude", "codex"], git: true })} />,
    )
    await flushProbe()
    const out = await frame()
    expect(out).toContain("installed but not signed in")
    expect(out).toContain("Claude · Codex")
    expect(out).not.toContain("✓ engines")
    // Not "install one" — the CLIs are there.
    expect(out).not.toContain("no engine CLI found")
    expect(out).toContain("rove doctor")
  })

  it("is honest when the environment is missing pieces", async () => {
    const { frame } = await renderComponent(
      <WelcomePane probe={probeWith({ engines: [], signedOut: [], git: false })} />,
    )
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
        onEnginePasteReady={NOOP}
        onDiffTabReady={NOOP}
        onSpawnChild={NOOP}
        onQuickFork={NOOP}
      />,
    )
    const out = await frame()
    expect(out).toContain("Select a task with a worktree")
    expect(out).not.toContain("Welcome to Rove")
  })
})
