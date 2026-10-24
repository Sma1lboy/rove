/** What the new-task and new-chat dialogs share: the engine list (names come from the engine registry) and the tab opener. */

import { useEffect, useState } from "react"
import { ChipRow } from "./chip-row.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import type { ComposerEngine } from "./new-session.ts"
import { toast } from "./ui.ts"

/** `engines.list` row; the bridge's `EngineRow`, trimmed to what the pages read (models and effort levels are the registry's). */
export interface EngineRow extends ComposerEngine {
  readonly name: string
  readonly ready?: boolean
}

export interface EngineChoice {
  readonly engines: readonly EngineRow[]
  readonly engine: string
  readonly setEngine: (id: string) => void
}

/** The engine list, with the first ready engine preselected (the TUI's picker default). */
export function useEngineChoice(model: AppModel): EngineChoice {
  const [engines, setEngines] = useState<readonly EngineRow[]>([])
  const [engine, setEngine] = useState("")
  useEffect(() => {
    void model.client
      .request<{ engines: EngineRow[] }>("engines.list")
      .then((res) => {
        setEngines(res.engines)
        setEngine((res.engines.find((e) => e.ready !== false) ?? res.engines[0])?.id ?? "")
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
  const [panes, setPanes] = useState<readonly PaneRow[]>([])
  useEffect(() => {
    void model.client
      .request<{ panes: PaneRow[] }>("plugin.panes")
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
