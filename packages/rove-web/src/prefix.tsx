/**
 * The TUI's prefix layer (`keymap-dispatch.ts`): Ctrl+A arms it from anywhere, the
 * terminal included; the next key runs a `prefixKeys` binding; Escape cancels; a miss
 * is swallowed so it can't type into the terminal; an open dialog blocks arming.
 * Holding Ctrl alone for 400 ms reveals the direct shortcuts (`ctrl-hold.ts`).
 * What the HUD shows is `prefix-guide.tsx`; the state it reads is `prefix-state.ts`.
 *
 * Which stroke runs what is read from the command registry, so a stroke registered by
 * any pane (the terminal's `/`, a split's `w`) competes by focus like the TUI's binding stack.
 */

import { CTRL_HOLD_THRESHOLD_MS } from "@sma1lboy/rove/src/tui/lib/ctrl-hold.ts"
import { useEffect } from "react"
import { type WebCommand, allCommands, appliesOn, currentSurface, registerCommands, specificity } from "./commands.ts"
import { t } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { NewTaskDialog } from "./new-task-dialog.tsx"
import { openPalette } from "./palette-view.tsx"
import { focusPane } from "./pane-focus.ts"
import { PREFIX_TIMEOUT_MS, hud, hudPush } from "./prefix-state.ts"
import { aimedTask } from "./rail-aim.ts"
import { SettingsDialog } from "./settings-view.tsx"
import { isSplit } from "./split-model.ts"
import { fixChecksFlow, syncBaseFlow } from "./task-flows.tsx"
import { dialog, page, toast, zen } from "./ui.ts"

interface PrefixAction {
  readonly strokes: readonly string[]
  /** The TUI binding id: the HUD label comes from its `keys.desc` entry. */
  readonly id: string
  /** False hides it from the guide and makes the stroke a miss, as an unreachable TUI row. */
  readonly live: (model: AppModel) => boolean
  readonly run: (model: AppModel) => void
}

const selectedTask = (model: AppModel) => {
  const { taskId } = model.selection.get()
  return model.tasks.get()?.tasks.find((task) => task.id === taskId) ?? null
}

/** The same Ctrl+W route as the split: `workspace.split.close` owns `w` while the tab is split. */
const unsplit = (model: AppModel): boolean => {
  const { taskId, tabId } = model.selection.get()
  const tab = taskId ? model.tabs.get()[taskId]?.find((row) => row.id === tabId) : undefined
  return !!tab && !isSplit(tab.split)
}

export const ACTIONS: readonly PrefixAction[] = [
  { strokes: ["/"], id: "palette.open", live: () => true, run: openPalette },
  {
    strokes: ["n"],
    id: "task.new.global",
    live: () => true,
    run: (model) => dialog.set(<NewTaskDialog model={model} repo={selectedTask(model)?.repo} />),
  },
  {
    strokes: ["c"],
    id: "chat.tab.fork",
    live: (m) => !!selectedTask(m),
    run: (model) => {
      const task = selectedTask(model)
      if (task) dialog.set(<NewChatDialog model={model} taskId={task.id} context="continue" />)
    },
  },
  {
    strokes: ["f"],
    id: "chat.fork.new",
    live: (m) => !!selectedTask(m),
    run: (model) => {
      const task = selectedTask(model)
      if (task) dialog.set(<NewChatDialog model={model} taskId={task.id} destination="fork" />)
    },
  },
  {
    strokes: [","],
    id: "settings.open",
    live: () => true,
    run: (model) => dialog.set(<SettingsDialog client={model.client} />),
  },
  { strokes: ["i"], id: "inbox.show", live: () => true, run: (model) => dialog.set(<InboxDialog model={model} />) },
  { strokes: ["h"], id: "focus.previous", live: () => true, run: () => focusPane(-1) },
  { strokes: ["l"], id: "focus.next", live: () => true, run: () => focusPane(1) },
  { strokes: ["z"], id: "workspace.zenToggle", live: (m) => !!selectedTask(m), run: () => zen.set(!zen.get()) },
  {
    strokes: ["p", "P"],
    id: "files.createPR",
    live: (m) => !!selectedTask(m),
    run: (model) => {
      const task = selectedTask(model)
      if (!task) return
      void model.client
        .request("tab.requestPR", model.engineTarget(task.id))
        .then(() => toast(t("files.prRequested")))
        .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
    },
  },
  {
    strokes: ["w"],
    id: "chat.tab.close",
    live: (m) => !!m.selection.get().tabId && unsplit(m),
    run: (model) => {
      const { taskId, tabId } = model.selection.get()
      if (!taskId || !tabId) return
      // No confirm: the TUI's `<prefix> w` closes the active tab outright.
      void model.client
        .request("tab.close", { taskId, tabId })
        .then(() => model.refreshTabsNow())
        .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
    },
  },
  // Rail pages in the rail's top-to-bottom order; they swap only the workspace, so 1 → 2 → 3 hops directly.
  { strokes: ["1"], id: "kanban.open", live: () => true, run: () => page.set("kanban") },
  { strokes: ["2"], id: "automations.open", live: () => true, run: () => page.set("routines") },
  { strokes: ["3"], id: "workItems.open", live: () => true, run: () => page.set("issues") },
  {
    strokes: ["m"],
    id: "task.moveMode",
    live: (m) => !!aimedTask(m),
    run: () => {
      moveMode.set(!moveMode.get())
      document.querySelector<HTMLElement>(".rail")?.focus()
    },
  },
  {
    strokes: ["u"],
    id: "files.syncBase",
    live: (m) => aimedTask(m)?.kind === "task",
    run: (model) => {
      const task = aimedTask(model)
      if (task) void syncBaseFlow(model, task.id)
    },
  },
  {
    strokes: ["k"],
    id: "files.fixChecks",
    live: (m) => !!aimedTask(m),
    run: (model) => {
      const task = aimedTask(model)
      if (task) void fixChecksFlow(model, task.id, t("taskops.fixSent"))
    },
  },
]

registerCommands(() =>
  ACTIONS.map((action) => ({
    id: action.id,
    chords: action.strokes,
    prefix: true,
    live: action.live,
    run: action.run,
  })),
)

function strokeOf(e: KeyboardEvent): string {
  return e.key.length === 1 ? e.key : e.key.toLowerCase()
}

/** The prefix command a stroke runs here: the focused pane's own beats the workspace's beats global. */
function resolve(model: AppModel, stroke: string): WebCommand | undefined {
  const surface = currentSurface()
  return allCommands()
    .filter((c) => c.prefix && c.chords.includes(stroke) && appliesOn(c, surface) && c.live?.(model) !== false)
    .sort((a, b) => specificity(a, surface) - specificity(b, surface))[0]
}

let armedAt: number | null = null
let armTimer: number | null = null

function disarm(): void {
  armedAt = null
  if (armTimer !== null) window.clearTimeout(armTimer)
  armTimer = null
  const state = hud.get()
  if (state.guide?.kind === "prefix") hud.set({ ...state, guide: null })
}

/** The mouse path in (the footer's hint, a keycap badge): arm without a key, like `armPrefixFromCurrentStack`. */
export function armPrefix(): void {
  if (dialog.get()) return
  armedAt = Date.now()
  hud.set({ ...hud.get(), guide: { kind: "prefix", armedAt } })
  if (armTimer !== null) window.clearTimeout(armTimer)
  armTimer = window.setTimeout(disarm, PREFIX_TIMEOUT_MS)
}

/** Run the armed prefix's stroke (a key, or a click on a guide row); a miss shows `∅`. */
export function runPrefixStroke(model: AppModel, stroke: string): void {
  disarm()
  const command = resolve(model, stroke)
  hudPush(stroke, command?.id ?? null)
  command?.run(model)
}

let holdTimer: number | null = null

function cancelHold(): void {
  if (holdTimer !== null) window.clearTimeout(holdTimer)
  holdTimer = null
  const state = hud.get()
  if (state.guide?.kind === "direct") hud.set({ ...state, guide: null })
}

function startHold(): void {
  if (holdTimer !== null || dialog.get()) return
  holdTimer = window.setTimeout(() => {
    disarm()
    hud.set({ ...hud.get(), guide: { kind: "direct" } })
  }, CTRL_HOLD_THRESHOLD_MS)
}

/** Window-level, capture phase: it must see Ctrl+A before xterm does. */
export function usePrefixLayer(model: AppModel): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control") {
        if (!e.repeat) startHold()
        return
      }
      // Any other key ends a hold, so Ctrl+C or Ctrl+A never flashes the guide.
      cancelHold()
      if (["Shift", "Alt", "Meta"].includes(e.key)) return
      if (armedAt !== null && Date.now() - armedAt <= PREFIX_TIMEOUT_MS) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === "Escape") return disarm()
        runPrefixStroke(model, strokeOf(e))
        return
      }
      disarm()
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && !dialog.get()) {
        e.preventDefault()
        e.stopImmediatePropagation()
        armPrefix()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => e.key === "Control" && cancelHold()
    window.addEventListener("keydown", onKey, { capture: true })
    window.addEventListener("keyup", onKeyUp, { capture: true })
    window.addEventListener("blur", cancelHold)
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true })
      window.removeEventListener("keyup", onKeyUp, { capture: true })
      window.removeEventListener("blur", cancelHold)
      cancelHold()
      disarm()
    }
  }, [model])
}
