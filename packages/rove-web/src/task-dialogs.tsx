/** What the new-task and new-chat dialogs share: the engine list (names come from the engine registry) and the tab opener. */

import { useEffect, useState } from "react"
import { ChipRow } from "./chip-row.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { type ComposerEngine, defaultEngineId, offeredEngines } from "./new-session.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { toast } from "./ui.ts"

/** `engines.list` row; the bridge's `EngineRow`, trimmed to what the pages read (models and effort levels are the registry's). */
export interface EngineRow extends ComposerEngine {
  readonly name: string
}

export interface EngineChoice {
  readonly engines: readonly EngineRow[]
  readonly engine: string
  readonly setEngine: (id: string) => void
}

/** The engines Settings → Engines has on, preselecting the one `repo` was last started on (the TUI's picker default). */
export function useEngineChoice(model: AppModel, repo?: string): EngineChoice {
  type Reply = { engines: EngineRow[]; preferred?: string }
  const params = repo ? { repo } : {}
  const [seed] = useState(() => {
    const last = lastReply<Reply>(model, "engines.list", params)
    const offered = last ? offeredEngines(last.engines) : []
    return { offered, engine: last ? defaultEngineId(offered, last.preferred) : "" }
  })
  const [engines, setEngines] = useState<readonly EngineRow[]>(seed.offered)
  const [engine, setEngine] = useState(seed.engine)
  // biome-ignore lint/correctness/useExhaustiveDependencies: preselected once per dialog; a later repo change keeps the user's pick
  useEffect(() => {
    void requestRemembered<Reply>(model, "engines.list", params)
      .then((res) => {
        const offered = offeredEngines(res.engines)
        setEngines(offered)
        setEngine(defaultEngineId(offered, res.preferred))
      })
      .catch(() => setEngines([]))
  }, [model])
  return { engines, engine, setEngine }
}

/** The picker's own "shell" choice (TUI ctrl+e picker), not an engine id. */
export const SHELL = "shell"

/** A plugin pane choice is `pane:<plugin>.<pane>`, the TUI picker's `pane:` key. */
const PANE_PREFIX = "pane:"

export const isPane = (pick: string): boolean => pick.startsWith(PANE_PREFIX)
export const paneIdOf = (pick: string): string => pick.slice(PANE_PREFIX.length)

/** `plugin.panes` row: a pane an enabled plugin registered. */
export interface PaneRow {
  readonly id: string
  readonly title: string
}

/** The registered plugin panes, offered beside the engines as the TUI picker does. */
export function usePanes(model: AppModel): readonly PaneRow[] {
  const [panes, setPanes] = useState<readonly PaneRow[]>(
    () => lastReply<{ panes: PaneRow[] }>(model, "plugin.panes")?.panes ?? [],
  )
  useEffect(() => {
    void requestRemembered<{ panes: PaneRow[] }>(model, "plugin.panes")
      .then((res) => setPanes(res.panes))
      .catch(() => setPanes([]))
  }, [model])
  return panes
}

export function EnginePicker(props: {
  engines: readonly EngineRow[]
  value: string
  onChange: (id: string) => void
  withShell?: boolean
  panes?: readonly PaneRow[]
}) {
  const choices = [
    ...props.engines,
    ...(props.withShell ? [{ id: SHELL, name: t("tab.shell") }] : []),
    ...(props.panes ?? []).map((pane) => ({ id: PANE_PREFIX + pane.id, name: pane.title })),
  ]
  return (
    <ChipRow
      label={t("newTask.engine")}
      field="engine"
      value={props.value}
      onChange={props.onChange}
      choices={choices.map((engine) => ({
        id: engine.id,
        label: engine.name,
        dim: "ready" in engine && engine.ready === false,
        title: "ready" in engine && engine.ready === false ? t("newTask.notReady") : undefined,
      }))}
    />
  )
}

/** "New conversation": a child task sharing this directory, on the engine this project used last, no picker (the TUI's ctrl+t). */
export function newChatHere(model: AppModel, taskId: string): Promise<void> {
  return openTab(model, taskId, { kind: "engine", latest: true }).catch((e) => toast(String(e), "error"))
}

/**
 * Open a tab and select it. No prompt = an empty engine or a shell, as the TUI picker. An engine
 * is a child task of `taskId` (the bridge replies with its id), so that is what gets selected.
 */
export async function openTab(
  model: AppModel,
  taskId: string,
  args: { kind: "engine" | "shell"; engine?: string; prompt?: string; latest?: boolean },
): Promise<void> {
  const { tabId, taskId: child } = await model.client.request<{ tabId: string; taskId?: string }>("tab.new", {
    taskId,
    kind: args.kind,
    ...(args.engine ? { engine: args.engine } : {}),
    ...(args.prompt ? { prompt: args.prompt } : {}),
    ...(args.latest ? { latest: true } : {}),
  })
  if (child) {
    model.selectWhenListed(child)
    return
  }
  await model.refreshTabsNow()
  model.select(taskId, tabId)
}
