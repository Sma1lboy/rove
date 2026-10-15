/**
 * Create flows: a new task (TUI new-task dialog, Existing mode) and a new
 * conversation tab on a task (TUI ctrl+e picker: an engine or a shell). Both read
 * the engine list from the bridge, so names come from the engine registry.
 */

import { useEffect, useState } from "react"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"

/** `engines.list` row; the bridge's `EngineRow`, trimmed to what the page reads. */
interface EngineRow {
  readonly id: string
  readonly name: string
  readonly ready?: boolean
}

interface EngineChoice {
  readonly engines: readonly EngineRow[]
  readonly engine: string
  readonly setEngine: (id: string) => void
}

/** The engine list, with the first ready engine preselected (the TUI's picker default). */
function useEngineChoice(model: AppModel): EngineChoice {
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
const SHELL = "shell"

function EnginePicker(props: {
  engines: readonly EngineRow[]
  value: string
  onChange: (id: string) => void
  withShell?: boolean
}) {
  const choices = props.withShell ? [...props.engines, { id: SHELL, name: t("tab.shell") }] : props.engines
  return (
    <div className="chips-row" aria-label={t("newTask.engine")}>
      {choices.map((engine) => (
        <button
          type="button"
          aria-pressed={engine.id === props.value}
          key={engine.id}
          className={`chip-button ${engine.id === props.value ? "is-active" : ""}`}
          title={engine.ready === false ? t("newTask.notReady") : undefined}
          onClick={() => props.onChange(engine.id)}
        >
          {engine.name}
          {engine.ready === false && <span className="muted"> ·</span>}
        </button>
      ))}
    </div>
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

export function NewTaskDialog({ model, repo }: { model: AppModel; repo?: string }) {
  useLocale()
  const { engines, engine, setEngine } = useEngineChoice(model)
  const [repos, setRepos] = useState<readonly string[]>([])
  const [repoValue, setRepo] = useState(repo ?? "")
  const [title, setTitle] = useState("")
  const [prompt, setPrompt] = useState("")
  const { busy, error, setError, submit } = useSubmit()
  useEffect(() => {
    void model.client.request<{ repos: string[] }>("repos.list").then((res) => {
      setRepos(res.repos)
      setRepo((current) => current || res.repos[0] || "")
    })
  }, [model])

  return (
    <DialogShell title={t("newTask.title")} wide>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (!repoValue) {
            setError(t("newTask.needRepo"))
            return
          }
          void submit(async () => {
            const res = await model.client.request<{ taskIds: string[] }>("task.spawn", {
              repo: repoValue,
              ...(engine ? { engine } : {}),
              ...(title.trim() ? { title: title.trim() } : {}),
              ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
            })
            const created = res.taskIds[0]
            if (created) model.selectWhenListed(created)
          })
        }}
      >
        <label className="field">
          <span className="kicker">{t("newTask.repo")}</span>
          <select className="input" value={repoValue} onChange={(e) => setRepo(e.target.value)}>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="kicker">{t("newTask.engine")}</span>
          <EnginePicker engines={engines} value={engine} onChange={setEngine} />
        </div>
        <label className="field">
          <span className="kicker">{t("newTask.taskTitle")}</span>
          <input
            className="input"
            spellCheck={false}
            placeholder={t("newTask.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="kicker">{t("newTask.prompt")}</span>
          <textarea
            className="input textarea"
            // biome-ignore lint/a11y/noAutofocus: the field a new task starts from
            autoFocus
            rows={5}
            placeholder={t("newTask.promptPlaceholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
            }}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy} submitLabel={t("newTask.create")} />
      </form>
    </DialogShell>
  )
}

/** TUI ctrl+e picker: an engine (first message optional) or a shell. */
export function NewChatDialog({ model, taskId }: { model: AppModel; taskId: string }) {
  useLocale()
  const { engines, engine, setEngine } = useEngineChoice(model)
  const [prompt, setPrompt] = useState("")
  const { busy, error, submit } = useSubmit()
  const shell = engine === SHELL
  return (
    <DialogShell title={t("newChat.title")} wide>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(() =>
            shell
              ? openTab(model, taskId, { kind: "shell" })
              : openTab(model, taskId, { kind: "engine", engine, prompt: prompt.trim() }),
          )
        }}
      >
        <div className="field">
          <span className="kicker">{t("newTask.engine")}</span>
          <EnginePicker engines={engines} value={engine} onChange={setEngine} withShell />
        </div>
        {!shell && (
          <label className="field">
            <span className="kicker">{t("newChat.prompt")}</span>
            <textarea
              className="input textarea"
              // biome-ignore lint/a11y/noAutofocus: the dialog's main field
              autoFocus
              rows={4}
              placeholder={t("newChat.promptPlaceholder")}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
              }}
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy} submitLabel={t("newChat.start")} />
      </form>
    </DialogShell>
  )
}
