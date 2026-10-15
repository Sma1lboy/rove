/**
 * Create flows: a new task (TUI new-task dialog, Existing mode) and a new
 * conversation tab on a task (TUI ctrl+e picker, engine choice). Both read the
 * engine list from the bridge, so names come from the engine registry.
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

function EnginePicker(props: { engines: readonly EngineRow[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="chips-row" aria-label={t("newTask.engine")}>
      {props.engines.map((engine) => (
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

/** A new engine tab needs a first message: the bridge opens tabs by delivering one. */
export function NewChatDialog({ model, taskId }: { model: AppModel; taskId: string }) {
  useLocale()
  const { engines, engine, setEngine } = useEngineChoice(model)
  const [prompt, setPrompt] = useState("")
  const { busy, error, submit } = useSubmit()
  return (
    <DialogShell title={t("newChat.title")} wide>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (!prompt.trim()) return
          void submit(async () => {
            const { tabId } = await model.client.request<{ tabId: string }>("tab.new", {
              taskId,
              prompt: prompt.trim(),
              ...(engine ? { engine } : {}),
            })
            await model.refreshTabsNow()
            model.select(taskId, tabId)
          })
        }}
      >
        <div className="field">
          <span className="kicker">{t("newTask.engine")}</span>
          <EnginePicker engines={engines} value={engine} onChange={setEngine} />
        </div>
        <label className="field">
          <span className="kicker">{t("newChat.prompt")}</span>
          <textarea
            className="input textarea"
            // biome-ignore lint/a11y/noAutofocus: the dialog's main field
            autoFocus
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
            }}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy} submitLabel={t("newChat.start")} />
      </form>
    </DialogShell>
  )
}
