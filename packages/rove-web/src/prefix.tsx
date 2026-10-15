/**
 * The TUI's prefix layer (`keymap-dispatch.ts`): Ctrl+A arms it from anywhere, the
 * terminal included; the next key runs a `prefixKeys` binding; Escape cancels; a miss
 * is swallowed so it can't type into the terminal; an open dialog blocks arming.
 * The HUD (TUI `prefix-hud.tsx`) shows `ctrl+a ⋯` with the live options, then
 * `ctrl+a + z → Toggle zen mode` (or `∅`) for a few seconds.
 */

import { en as keysEn, zh as keysZh } from "@sma1lboy/rove/src/tui/i18n/messages/keys.ts"
import { useEffect } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { InboxDialog } from "./inbox-view.tsx"
import type { AppModel } from "./model.ts"
import { moveMode } from "./move-mode.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { NewTaskDialog } from "./new-task-dialog.tsx"
import { usePrefs } from "./prefs.ts"
import { aimedTask } from "./rail-aim.ts"
import { SettingsDialog } from "./settings-view.tsx"
import { ShortcutBadges } from "./shortcut-badges.tsx"
import { createStore, useStore } from "./store.ts"
import { fixChecksFlow, syncBaseFlow } from "./task-flows.tsx"
import { dialog, page, toast, zen } from "./ui.ts"

const PREFIX_KEY = "ctrl+a"
/** `DEFAULT_PREFIX_CONFIGURATION.timeoutMs`, `PREFIX_HUD_TTL_MS`. */
const TIMEOUT_MS = 5000
const HUD_TTL_MS = 4000

interface PrefixAction {
  readonly strokes: readonly string[]
  /** The TUI binding id: the HUD label comes from its `keys.desc` entry. */
  readonly id: keyof typeof keysEn.desc
  /** False hides it from the guide and makes the stroke a miss, as an unreachable TUI row. */
  readonly live: (model: AppModel) => boolean
  readonly run: (model: AppModel) => void
}

const selectedTask = (model: AppModel) => {
  const { taskId } = model.selection.get()
  return model.tasks.get()?.tasks.find((task) => task.id === taskId) ?? null
}

/** sidebar → workspace → files, as `focus.next`: [pane, what takes focus in it]. */
const PANES: readonly (readonly [string, string])[] = [
  [".rail", ".rail"],
  [".workspace", ".preview, .term-slot:not(.is-hidden) textarea"],
  [".files", ".files"],
]
function focusPane(delta: 1 | -1): void {
  const at = Math.max(
    0,
    PANES.findIndex(([pane]) => document.activeElement?.closest(pane)),
  )
  for (let step = 1; step < PANES.length; step++) {
    const target = PANES[(at + delta * step + PANES.length * 2) % PANES.length]?.[1]
    const el = target ? document.querySelector<HTMLElement>(target) : null
    if (el) {
      el.focus()
      return
    }
  }
}

const ACTIONS: readonly PrefixAction[] = [
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
    live: (m) => !!m.selection.get().tabId,
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

interface HudState {
  readonly armed: boolean
  readonly last: { readonly stroke: string; readonly id: PrefixAction["id"] | null } | null
}
const hud = createStore<HudState>({ armed: false, last: null })

function strokeOf(e: KeyboardEvent): string {
  return e.key.length === 1 ? e.key : e.key.toLowerCase()
}

/** Window-level, capture phase: it must see Ctrl+A before xterm does. */
export function usePrefixLayer(model: AppModel): void {
  useEffect(() => {
    let armedAt: number | null = null
    let clear: number | null = null
    const settle = (last: HudState["last"]) => {
      hud.set({ armed: false, last })
      if (clear !== null) window.clearTimeout(clear)
      clear = window.setTimeout(() => hud.set({ armed: false, last: null }), HUD_TTL_MS)
    }
    const onKey = (e: KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return
      if (armedAt !== null && Date.now() - armedAt <= TIMEOUT_MS) {
        armedAt = null
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === "Escape") return settle(null)
        const stroke = strokeOf(e)
        const action = ACTIONS.find((a) => a.strokes.includes(stroke) && a.live(model))
        settle({ stroke, id: action?.id ?? null })
        action?.run(model)
        return
      }
      armedAt = null
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && !dialog.get()) {
        armedAt = Date.now()
        e.preventDefault()
        e.stopImmediatePropagation()
        hud.set({ armed: true, last: null })
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true })
      if (clear !== null) window.clearTimeout(clear)
    }
  }, [model])
}

/** `keys.desc` clipped at a dash-led elaboration, as the TUI HUD's `actionLabel`. */
function actionLabel(id: PrefixAction["id"], zh: boolean): string {
  const label = (zh ? keysZh : keysEn).desc[id]
  const dash = label.search(/\s—\s|——/)
  return dash > 0 ? label.slice(0, dash) : label
}

export function PrefixHud({ model }: { model: AppModel }) {
  const lang = useLocale()
  const state = useStore(hud)
  // Re-read liveness when the selection changes under an armed HUD.
  useStore(model.selection)
  const zh = lang === "zh"
  const { prefs } = usePrefs()
  if (!state.armed && !state.last) return null
  return (
    <>
      <output className="prefix-hud mono">
        {state.armed ? (
          <>
            <div className="prefix-hud-head">
              <span className="tone-accent">{PREFIX_KEY}</span> ⋯
            </div>
            {ACTIONS.filter((a) => a.live(model)).map((a) => (
              <div key={a.id} className="prefix-hud-row">
                <span className="prefix-hud-key">{a.strokes.join(" / ")}</span>
                <span>{actionLabel(a.id, zh)}</span>
              </div>
            ))}
          </>
        ) : state.last ? (
          <div className="prefix-hud-head">
            <span className="tone-accent">{PREFIX_KEY}</span> + {state.last.stroke} →{" "}
            {state.last.id ? actionLabel(state.last.id, zh) : <span className="muted">∅</span>}
          </div>
        ) : null}
      </output>
      {state.armed && prefs.prefixTap === "local" && (
        <ShortcutBadges
          rows={ACTIONS.filter((a) => a.live(model)).map((a) => ({ id: a.id, stroke: a.strokes[0] ?? "" }))}
        />
      )}
    </>
  )
}
