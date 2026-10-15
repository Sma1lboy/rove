/** What the new-task and new-chat dialogs share: the engine list (names come from the engine registry) and the tab opener. */

import { useEffect, useState } from "react"
import { ChipRow } from "./chip-row.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"

/** `engines.list` row; the bridge's `EngineRow`, trimmed to what the page reads. */
export interface EngineRow {
  readonly id: string
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

export function EnginePicker(props: {
  engines: readonly EngineRow[]
  value: string
  onChange: (id: string) => void
  withShell?: boolean
}) {
  const choices = props.withShell ? [...props.engines, { id: SHELL, name: t("tab.shell") }] : props.engines
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

/** Open a tab and select it. No prompt = an empty engine or a shell, as the TUI picker. */
export async function openTab(
  model: AppModel,
  taskId: string,
  args: { kind: "engine" | "shell"; engine?: string; prompt?: string },
): Promise<void> {
  const { tabId } = await model.client.request<{ tabId: string }>("tab.new", {
    taskId,
    kind: args.kind,
    ...(args.engine ? { engine: args.engine } : {}),
    ...(args.prompt ? { prompt: args.prompt } : {}),
  })
  await model.refreshTabsNow()
  model.select(taskId, tabId)
}
