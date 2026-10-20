/**
 * Change engine (TUI `engine-picker-dialog.tsx`): a pick over the engines this machine can
 * run, a reasoning-level row for engines that declare levels, and a model input for engines
 * with a model flag. Engine, level and model go to the daemon in one call; like `v`, the
 * change applies to the task's next session.
 */

import { useEffect, useState } from "react"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { t } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { tc } from "./tui-copy.ts"
import "./taskops.css"
import { toast } from "./ui.ts"

export interface PickerEngine {
  readonly id: string
  readonly name: string
  readonly ready?: boolean
  readonly effortLevels?: readonly string[]
  readonly acceptsModel?: boolean
  readonly models?: ReadonlyArray<{ readonly id: string }> | null
}

interface Current {
  readonly engine?: string
  readonly effort?: string
  readonly model?: string
}

/** The level to open on: the task's own when that engine still declares it, else "engine default". */
function seedEffort(engine: PickerEngine | undefined, current: string | undefined): string {
  const level = current?.trim() ?? ""
  return level && engine?.effortLevels?.includes(level) ? level : ""
}

export function ChangeEngineDialog({ model, taskId }: { model: AppModel; taskId: string }) {
  const [engines, setEngines] = useState<readonly PickerEngine[]>([])
  const [current, setCurrent] = useState<Current>({})
  const [pick, setPick] = useState("")
  const [effort, setEffort] = useState("")
  const [modelText, setModelText] = useState("")
  const [loaded, setLoaded] = useState(false)
  const { busy, error, submit } = useSubmit()

  useEffect(() => {
    void Promise.all([
      model.client.request<{ engines: PickerEngine[] }>("engines.list"),
      model.client.request<{ task: Current }>("task.get", { taskId }),
    ]).then(([list, got]) => {
      // The TUI lists detected engines; the task's own stays so it can be re-picked at another level.
      const usable = list.engines.filter((e) => e.ready !== false || e.id === got.task.engine)
      const start = usable.find((e) => e.id === got.task.engine) ?? usable[0]
      setEngines(usable)
      setCurrent(got.task)
      setPick(start?.id ?? "")
      setEffort(seedEffort(start, got.task.effort))
      setModelText(start?.id === got.task.engine ? (got.task.model ?? "") : "")
      setLoaded(true)
    })
  }, [model, taskId])

  const engine = engines.find((e) => e.id === pick)
  const levels = engine?.effortLevels ?? []
  const choices = levels.length > 0 ? ["", ...levels] : []
  const suggestions = (engine?.models ?? [])
    .map((m) => m.id)
    .filter((id) => id.toLowerCase().includes(modelText.trim().toLowerCase()) && id !== modelText.trim())
    .slice(0, 6)

  const choose = (id: string) => {
    setPick(id)
    const next = engines.find((e) => e.id === id)
    setEffort(seedEffort(next, id === current.engine ? current.effort : undefined))
    setModelText(id === current.engine ? (current.model ?? "") : "")
  }
  const move = (delta: 1 | -1) => {
    const at = engines.findIndex((e) => e.id === pick)
    const next = engines[Math.max(0, Math.min(engines.length - 1, at + delta))]
    if (next) choose(next.id)
  }
  const stepEffort = (delta: 1 | -1) => {
    if (choices.length === 0) return
    const at = Math.max(0, choices.indexOf(effort))
    setEffort(choices[Math.max(0, Math.min(choices.length - 1, at + delta))] ?? "")
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inInput = e.target instanceof HTMLInputElement
    if (e.key === "ArrowUp" && !inInput) move(-1)
    else if (e.key === "ArrowDown" && !inInput) move(1)
    else if ((e.key === "ArrowLeft" || e.key === "h") && !inInput) stepEffort(-1)
    else if ((e.key === "ArrowRight" || e.key === "l") && !inInput) stepEffort(1)
    else return
    e.preventDefault()
  }

  const apply = () =>
    submit(async () => {
      if (!engine) return
      const nextEffort = levels.length > 0 ? effort : undefined
      const nextModel = engine.acceptsModel ? modelText.trim() : undefined
      const same =
        engine.id === current.engine &&
        (nextEffort === undefined || nextEffort === (current.effort ?? "")) &&
        (nextModel === undefined || nextModel === (current.model ?? ""))
      if (same) return
      await model.client.request("task.setEngine", {
        taskId,
        engine: engine.id,
        ...(nextEffort === undefined ? {} : { effort: nextEffort }),
        ...(nextModel === undefined ? {} : { model: nextModel }),
      })
      toast(tc("tasks", "toast.engineSwitched", { engine: engine.name }))
    })

  return (
    <DialogShell title={tc("tasks", "changeEngine.title")} wide>
      <form
        className="dialog-body"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault()
          void apply()
        }}
      >
        <ul className="choices" aria-label={tc("tasks", "changeEngine.title")}>
          {engines.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                aria-pressed={e.id === pick}
                className={`row ${e.id === pick ? "is-selected" : ""}`}
                onClick={() => choose(e.id)}
              >
                <span className="glyph tone-accent">{e.id === pick ? "●" : " "}</span>
                <span className="row-title">{e.name}</span>
                {e.id === current.engine && <span className="muted">{tc("tasks", "changeEngine.current")}</span>}
              </button>
            </li>
          ))}
        </ul>
        {loaded && engine && engine.acceptsModel && (
          <label className="field">
            <span className="kicker">{tc("tasks", "engineModel.label")}</span>
            <input
              className="input"
              spellCheck={false}
              placeholder={tc("tasks", "engineModel.placeholder")}
              value={modelText}
              onChange={(e) => setModelText(e.target.value)}
            />
            {suggestions.length > 0 && (
              <div className="chips-row model-suggest">
                {suggestions.map((id) => (
                  <button key={id} type="button" className="chip-button" onClick={() => setModelText(id)}>
                    {id}
                  </button>
                ))}
              </div>
            )}
          </label>
        )}
        {choices.length > 0 && (
          <div className="field">
            <span className="kicker">{tc("tasks", "changeEngine.effortLabel")}</span>
            <div className="chips-row">
              {choices.map((level) => (
                <button
                  key={level || "default"}
                  type="button"
                  aria-pressed={level === effort}
                  className={`chip-button ${level === effort ? "is-active" : ""}`}
                  onClick={() => setEffort(level)}
                >
                  {level === "" ? tc("tasks", "changeEngine.noEffort") : level}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="muted taskops-hint">
          {[
            tc("tasks", "changeEngine.footer.engine"),
            ...(engine?.acceptsModel ? [tc("tasks", "changeEngine.footer.model")] : []),
            ...(choices.length > 0 ? [tc("tasks", "changeEngine.footer.effort")] : []),
            tc("tasks", "changeEngine.footer.set"),
            tc("tasks", "changeEngine.footer.cancel"),
          ].join(" · ")}
        </p>
        {error && <p className="error">{error}</p>}
        <DialogActions busy={busy || !loaded} submitLabel={t("taskops.set")} />
      </form>
    </DialogShell>
  )
}
