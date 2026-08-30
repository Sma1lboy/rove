/** @jsxImportSource @opentui/react */
/**
 * Session DISCOVERY on the hydration pass (`useTabHydration`), for the engine
 * whose id Rove can neither pin nor read.
 *
 * Claude accepts `--session-id`, so its tabs know their conversation before
 * the process exists; codex publishes its thread id in its own OSC title. Kimi
 * does neither — its CLI cannot be told what to call a new session, and its
 * title is a sentence — so nothing ever recorded which session a kimi tab
 * belonged to and every restart opened a blank one. The only remaining source
 * is the session store, which is what this pass asks.
 *
 * It runs in HYDRATION rather than the naming poll because `hydrating` is the
 * gate that holds the spawn back: an id learned after the tab respawned is an
 * id learned too late, and the poll's 5s tick is well after the fact.
 *
 * Lives in the bun-run render track: the hook is a React effect, so it needs a
 * real renderer to mount against.
 */

import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ReactNode } from "react"
import { type TabLifecycleIO, useTabHydration } from "../../src/tui-react/workspace/use-tab-lifecycle"
import type { EngineTab, TabsState } from "../../src/tui/workspace/terminal-tabs-core"
import { renderComponent } from "./harness"

const SESSION_ID = "session_fb636b17-73fd-45c2-97f4-4bc4f3235bff"

let kimiHome: string | undefined
let worktree: string | undefined
const priorKimiHome = process.env.KIMI_CODE_HOME

afterEach(async () => {
  // biome-ignore lint/performance/noDelete: env cleanup must fully unset when the var was unset before the test (assigning undefined leaves it as the string "undefined").
  if (priorKimiHome === undefined) delete process.env.KIMI_CODE_HOME
  else process.env.KIMI_CODE_HOME = priorKimiHome
  if (kimiHome) await rm(kimiHome, { recursive: true, force: true })
  if (worktree) await rm(worktree, { recursive: true, force: true })
  kimiHome = undefined
  worktree = undefined
})

/** A real `~/.kimi-code` tree holding one session rooted at `worktree`. */
async function seedKimiSession(): Promise<void> {
  kimiHome = await mkdtemp(path.join(tmpdir(), "rove-kimi-home-"))
  worktree = await mkdtemp(path.join(tmpdir(), "rove-kimi-wt-"))
  const dir = path.join(kimiHome, "sessions", `wd_${SESSION_ID}`)
  await mkdir(path.join(dir, "agents", "main"), { recursive: true })
  // Deliberately NOT a format kobe parses — kimi ships no message reader, and
  // the whole point is that discovery works without one.
  await writeFile(path.join(dir, "agents", "main", "wire.jsonl"), '{"type":"protocol-frame"}\n')
  await writeFile(
    path.join(kimiHome, "session_index.jsonl"),
    `${JSON.stringify({ sessionId: SESSION_ID, sessionDir: dir, workDir: worktree })}\n`,
  )
  process.env.KIMI_CODE_HOME = kimiHome
}

/** Poll until the hydration effect's async store read has landed. */
async function until(done: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
}

/** A mutable `TabLifecycleIO` whose `update` refreshes `stateRef` like the host's. */
function lifecycleIO(state: TabsState, wt: string): TabLifecycleIO & { state: () => TabsState } {
  let current = state
  return {
    stateRef: {
      get current() {
        return current
      },
    },
    propsRef: { current: { vendor: "kimi", worktree: wt } },
    update: (next) => {
      current = next
    },
    state: () => current,
  }
}

test("a rehydrated kimi tab adopts the session its worktree already has", async () => {
  await seedKimiSession()
  const state: TabsState = {
    // No sessionId — exactly how every kimi tab persisted before this change.
    tabs: [{ kind: "engine", id: "tab-1", title: null, ordinal: 1, vendor: "kimi" }],
    activeId: "tab-1",
    nextOrdinal: 2,
  }
  const io = lifecycleIO(state, worktree as string)
  function Probe(): ReactNode {
    useTabHydration(true, io)
    return <text>probe</text>
  }
  await renderComponent(<Probe />)
  await until(() => (io.state().tabs[0] as EngineTab).sessionId != null)

  const tab = io.state().tabs[0] as EngineTab
  expect(tab.sessionId).toBe(SESSION_ID)
  // `spawned` rides along: a session on disk IS a conversation, and it is what
  // makes the next launch take the engine's resume verb instead of a blank one.
  expect(tab.spawned).toBe(true)
})
