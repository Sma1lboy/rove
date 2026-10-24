/**
 * New session, claude.ai/code's way: the workspace shows an empty "New session" with the composer at
 * the bottom. Project, branch and model/effort are chips under the prompt; Start spawns the task with
 * that prompt, so the engine boots in the task's own tab-1 and no empty task exists in between.
 */

import { useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { ChipPopover, ChoiceMenu, ModelMenu, SearchList } from "./new-session-menus.tsx"
import { effortChoices, modelChipLabel, modelChoices, repoChipLabel, spawnArgs } from "./new-session.ts"
import { NewTaskDialog, type ProbeResult } from "./new-task-dialog.tsx"
import { expandTilde, filterText, isPathInput, splitRepoRow, stripTrailingSlash } from "./new-task-paths.ts"
import { useStore } from "./store.ts"
import { useEngineChoice } from "./task-dialogs.tsx"
import { type NewSessionStart, dialog, newSession, openNewSession } from "./ui.ts"
import "./new-session.css"

/** New task: the composer for this machine's projects, the classic dialog (clone, adopt, remote) for another machine's. */
export function startNewTask(model: AppModel, repo?: string, machine?: string): void {
  if (machine === undefined) openNewSession(repo)
  else dialog.set(<NewTaskDialog model={model} repo={repo} machine={machine} />)
}

export function NewSessionView({ model, seed }: { model: AppModel; seed: NewSessionStart }) {
  const initialRepo = seed.repo
  useLocale()
  const choice = useEngineChoice(model)
  const selected = useStore(model.selection).taskId
  const fallback = model.tasks.get()?.tasks.find((task) => task.id === selected)?.repo
  const [saved, setSaved] = useState<readonly string[]>([])
  const [home, setHome] = useState("")
  const [repos, setRepos] = useState<readonly string[]>([])
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [baseBranch, setBaseBranch] = useState("")
  const [repoQuery, setRepoQuery] = useState("")
  const [branchQuery, setBranchQuery] = useState("")
  const [prompt, setPrompt] = useState("")
  const [pickedModel, setPickedModel] = useState("")
  const [pickedEffort, setPickedEffort] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  // The branch the opener chose applies to the project it chose, once.
  const seededBranch = useRef(seed.baseBranch)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting project is read once
  useEffect(() => {
    void Promise.all([
      model.client.request<{ repos: string[] }>("repos.list"),
      model.client.request<{ home: string }>("fs.subdirs", { path: "~/" }),
    ])
      .then(([list, fs]) => {
        setSaved(list.repos)
        setHome(fs.home)
        setRepos((now) => (now.length > 0 ? now : [initialRepo ?? fallback ?? list.repos[0]].filter((r) => !!r)))
      })
      .catch(() => {})
  }, [model, initialRepo])

  const primary = repos[0] ?? ""
  useEffect(() => {
    setProbe(null)
    setBaseBranch(seededBranch.current ?? "")
    if (!primary) return
    seededBranch.current = undefined
    let stale = false
    void model.client
      .request<ProbeResult>("repo.probe", { path: primary })
      .then((res) => !stale && setProbe(res))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [model, primary])

  useEffect(() => area.current?.focus(), [])

  const engine = choice.engines.find((e) => e.id === choice.engine)
  const models = modelChoices(engine, t("newSession.modelDefault"))
  const efforts = effortChoices(engine, t("newSession.effortDefault"))
  // A pick of the previous engine's model or level means nothing to this one.
  const modelValue = models.some((m) => m.id === pickedModel) ? pickedModel : ""
  const effortValue = efforts.some((e) => e.id === pickedEffort) ? pickedEffort : ""

  // `begin` false creates the task without running its engine: no prompt needed.
  const start = async (begin = true) => {
    setError(null)
    if (!primary) return setError(t("newSession.needRepo"))
    if (begin && !prompt.trim()) return setError(t("newSession.needPrompt"))
    setBusy(true)
    try {
      const fresh = await model.client.request<ProbeResult>("repo.probe", { path: primary })
      if (!fresh.ok) throw new Error(fresh.reason ?? primary)
      const res = await model.client.request<{ taskIds: string[] }>(
        "task.spawn",
        spawnArgs({
          repos: [fresh.repo],
          engine: choice.engine,
          baseBranch,
          prompt: begin ? prompt.trim() : "",
          model: modelValue,
          effort: effortValue,
        }),
      )
      newSession.set(null)
      const created = res.taskIds[0]
      if (created) model.selectWhenListed(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const typed = repoQuery.trim()
  const repoRows = filterText(saved, repoQuery).map((path) => {
    const { base, dir } = splitRepoRow(path)
    return { key: path, text: base, dim: dir, checked: path === primary }
  })
  const typedPath = isPathInput(typed) && !saved.includes(typed) ? stripTrailingSlash(expandTilde(typed, home)) : ""
  const branchRows = filterText(probe?.branches ?? [], branchQuery).map((name) => ({
    key: name,
    text: name,
    checked: name === (baseBranch || probe?.current),
  }))
  const branchLabel = baseBranch || probe?.current || ""

  return (
    <div className="new-session">
      <div className="new-session-hero">
        <h1 className="welcome-title">{t("newSession.title")}</h1>
        <p className="muted">{t("newSession.tagline")}</p>
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <textarea
          ref={area}
          className="composer-input"
          rows={4}
          spellCheck={false}
          placeholder={t("newSession.placeholder")}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            void start()
          }}
        />
        <div className="composer-bar">
          <ChipPopover field="repo" title={t("newSession.repo")} label={repoChipLabel(repos) || t("newSession.repo")}>
            {(close) => (
              <SearchList
                placeholder={t("newSession.repoSearch")}
                empty={t("newSession.repoEmpty")}
                rows={repoRows}
                query={repoQuery}
                onQuery={setRepoQuery}
                extra={typedPath ? { key: typedPath, text: typedPath } : null}
                onPick={(path) => {
                  setRepos([path])
                  setRepoQuery("")
                  close()
                }}
              />
            )}
          </ChipPopover>
          {probe?.ok && branchLabel && (
            <ChipPopover field="branch" title={t("newSession.branch")} label={branchLabel}>
              {(close) => (
                <SearchList
                  placeholder={t("newSession.branchSearch")}
                  empty={t("newSession.branchEmpty")}
                  rows={branchRows}
                  query={branchQuery}
                  onQuery={setBranchQuery}
                  onPick={(name) => {
                    setBaseBranch(name)
                    setBranchQuery("")
                    close()
                  }}
                />
              )}
            </ChipPopover>
          )}
          <span className="composer-grow" />
          {choice.engines.length > 1 && (
            <ChipPopover field="engine" title={t("newSession.engine")} label={engine?.name ?? t("newSession.engine")}>
              {(close) => (
                <ChoiceMenu
                  heading={t("newSession.engine")}
                  options={choice.engines.map((e) => ({ id: e.id, label: e.name, dim: e.ready === false }))}
                  value={choice.engine}
                  onPick={(id) => {
                    choice.setEngine(id)
                    close()
                  }}
                />
              )}
            </ChipPopover>
          )}
          {(models.length > 0 || efforts.length > 0) && (
            <ChipPopover
              field="model"
              title={t("newSession.model")}
              label={modelChipLabel(models, modelValue, effortValue, t("newSession.modelDefault"))}
            >
              {(close) => (
                <ModelMenu
                  models={models}
                  model={modelValue}
                  onModel={setPickedModel}
                  efforts={efforts}
                  effort={effortValue}
                  onEffort={setPickedEffort}
                  close={close}
                />
              )}
            </ChipPopover>
          )}
          <button type="button" className="composer-chip" disabled={busy} onClick={() => void start(false)}>
            {t("newSession.createOnly")}
          </button>
          <button type="submit" className="button" disabled={busy}>
            {t("newSession.start")}
          </button>
        </div>
        {error && <p className="error">※ {error}</p>}
        <button
          type="button"
          className="composer-more muted"
          onClick={() => dialog.set(<NewTaskDialog model={model} repo={primary || undefined} />)}
        >
          {t("newSession.moreWays")}
        </button>
      </form>
    </div>
  )
}
