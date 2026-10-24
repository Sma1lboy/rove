/** @jsxImportSource @opentui/react */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useEffect, useState } from "react"
import { type QuickForkOrchestrator, useQuickFork } from "../../src/tui-react/workspace/quick-fork"
import { type Task, toTaskId } from "../../src/types/task"
import { act, renderComponent } from "./harness"

const originalHome = process.env.ROVE_HOME_DIR
beforeEach(() => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-first-prompt-"))
})
afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = originalHome
})

test("a quick task has its prompt on the first selected render, before activation resolves", async () => {
  const firstPrompts: Array<string | undefined> = []
  const child = { id: toTaskId("child"), repo: "/fixture", worktreePath: "/fixture/child" } as Task
  const orch = {
    createTask: async () => child,
    setPrompt: async () => {},
  } as unknown as QuickForkOrchestrator
  let create: () => void = () => {}
  function Engine(props: { prompt: string | undefined }) {
    const [firstPrompt] = useState(props.prompt)
    useEffect(() => {
      firstPrompts.push(firstPrompt)
    }, [firstPrompt])
    return <text>{props.prompt ?? "missing prompt"}</text>
  }
  function Host() {
    const [selected, selectTask] = useState<string>()
    const quick = useQuickFork(orch, {
      selectTask,
      enterTask: () => new Promise(() => {}),
      notify: () => {},
      notifyError: () => {},
      t: (key) => key,
    })
    create = () =>
      quick.onQuickFork("/fixture", {
        prompt: "Explain this project",
        vendor: "codex",
        baseRef: "main",
        attachments: [],
        attempts: 1,
      })
    return selected ? <Engine prompt={quick.initialPromptFor(selected)} /> : <text>empty</text>
  }
  const { frame } = await renderComponent(<Host />)
  await act(async () => {
    create()
  })
  expect(await frame()).toContain("Explain this project")
  expect(firstPrompts).toEqual(["Explain this project"])
})

test("a quick task is titled from its first message and records it as the brief", async () => {
  const created: Array<{ title?: string; model?: string; modelEffort?: string }> = []
  const briefs: Array<[string, string]> = []
  const child = { id: toTaskId("child"), repo: "/fixture", worktreePath: "/fixture/child" } as Task
  const orch = {
    createTask: async (input: { title?: string }) => {
      created.push(input)
      return child
    },
    setPrompt: async (id: string, prompt: string) => {
      briefs.push([id, prompt])
    },
  } as unknown as QuickForkOrchestrator
  let create: () => void = () => {}
  function Host() {
    const quick = useQuickFork(orch, {
      selectTask: () => {},
      enterTask: async () => {},
      notify: () => {},
      notifyError: () => {},
      t: (key) => key,
    })
    create = () =>
      quick.onQuickFork("/fixture", {
        prompt: "Fix the login redirect",
        vendor: "codex",
        baseRef: "main",
        attachments: [],
        attempts: 1,
        model: "m-1",
        modelEffort: "high",
      })
    return <text>host</text>
  }
  await renderComponent(<Host />)
  await act(async () => {
    create()
  })
  expect(created).toEqual([
    expect.objectContaining({ title: "Fix the login redirect", model: "m-1", modelEffort: "high" }),
  ])
  expect(briefs).toEqual([["child", "Fix the login redirect"]])
})
