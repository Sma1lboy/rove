/**
 * New session, claude.ai/code's way: the workspace shows an empty "New session" with the composer at
 * the bottom. Project, branch and model/effort are chips under the prompt; Start spawns the task with
 * that prompt, so the engine boots in the task's own tab-1 and no empty task exists in between.
 */

import { useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { BranchesMenu, ChipPopover, ChoiceMenu, ModelMenu, SearchList } from "./new-session-menus.tsx"
import { effortChoices, modelChipLabel, modelChoices, repoChipLabel, spawnArgs, toggleRepo } from "./new-session.ts"
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

// The unsent prompt outlives the view: picking a task unmounts the composer, as switching chats does on claude.ai.
let promptDraft = ""

export function NewSessionView({ model, seed }: { model: AppModel; seed: NewSessionStart }) {
  const initialRepo = seed.repo
  useLocale()
  const choice = useEngineChoice(model)
  const selected = useStore(model.selection).taskId
  const fallback = model.tasks.get()?.tasks.find((task) => task.id === selected)?.repo
  const [saved, setSaved] = useState<readonly string[]>([])
  const [home, setHome] = useState("")
  const [repos, setRepos] = useState<readonly string[]>([])
  // Each picked repo's branches, probed once it is picked.
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult>>>({})
  // The ref each repo's worktree branches from ("" = its current branch), and the one branch name they share.
  const [bases, setBases] = useState<Readonly<Record<string, string>>>({})
  const [branchName, setBranchName] = useState("")
  const [repoQuery, setRepoQuery] = useState("")
  const [branchQuery, setBranchQuery] = useState("")
  const [prompt, setPromptState] = useState(promptDraft)
  const setPrompt = (text: string): void => {
    promptDraft = text
    setPromptState(text)
  }
  const [pickedModel, setPickedModel] = useState("")
  const [pickedEffort, setPickedEffort] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting project is read once
  useEffect(() => {
    void Promise.all([
      model.client.request<{ repos: string[] }>("repos.list"),
      model.client.request<{ home: string }>("fs.subdirs", { path: "~/" }),
    ])
      .then(([list, fs]) => {
        setSaved(list.repos)
        setHome(fs.home)
        const start = initialRepo ?? fallback ?? list.repos[0]
        setRepos((now) => (now.length > 0 || !start ? now : [start]))
        // The branch the opener chose applies to the project it chose.
        if (start && seed.baseBranch) setBases((now) => ({ ...now, [start]: seed.baseBranch ?? "" }))
      })
      .catch(() => {})
  }, [model, initialRepo])

  const primary = repos[0] ?? ""
  const probe = probes[primary] ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: a repo is probed once, when first picked
  useEffect(() => {
    for (const path of repos) {
      if (path in probes) continue
      void model.client
        .request<ProbeResult>("repo.probe", { path })
        .then((res) => setProbes((now) => ({ ...now, [path]: res })))
        .catch(() => {})
    }
  }, [model, repos])

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
      // Every pick is re-probed: a typed path may not be a repo, and the daemon wants canonical roots.
      const fresh = await Promise.all(repos.map((path) => model.client.request<ProbeResult>("repo.probe", { path })))
      const bad = fresh.find((res) => !res.ok)
      if (bad) throw new Error(bad.reason ?? bad.repo)
      const res = await model.client.request<{ taskIds: string[] }>(
        "task.spawn",
        spawnArgs({
          repos: repos.map((path, i) => ({ repo: fresh[i]?.repo ?? path, baseRef: bases[path] ?? "" })),
          branch: branchName.trim(),
          engine: choice.engine,
          prompt: begin ? prompt.trim() : "",
          model: modelValue,
          effort: effortValue,
        }),
      )
      promptDraft = ""
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
    return {
      key: path,
      text: base,
      dim: path === primary && repos.length > 1 ? `${t("newSession.primary")} · ${dir}` : dir,
      checked: repos.includes(path),
    }
  })
  const typedPath = isPathInput(typed) && !saved.includes(typed) ? stripTrailingSlash(expandTilde(typed, home)) : ""
  const branchRows = filterText(probe?.branches ?? [], branchQuery).map((name) => ({
    key: name,
    text: name,
    checked: name === (bases[primary] || probe?.current),
  }))
  const branchLabel = bases[primary] || probe?.current || ""
  const branchRepos = repos.map((path) => ({
    path,
    name: splitRepoRow(path).base,
    primary: path === primary,
    branches: probes[path]?.branches ?? [],
    current: probes[path]?.current ?? "",
    base: bases[path] ?? "",
  }))

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
          <ChipPopover
            field="repo"
            title={repos.length > 1 ? t("newSession.repoCount", { count: repos.length }) : t("newSession.repo")}
            label={repoChipLabel(repos) || t("newSession.repo")}
          >
            {() => (
              // A check-list: a pick toggles and the list stays open, so several repos go in one visit.
              <SearchList
                placeholder={t("newSession.repoSearch")}
                empty={t("newSession.repoEmpty")}
                rows={repoRows}
                query={repoQuery}
                onQuery={setRepoQuery}
                extra={typedPath ? { key: typedPath, text: typedPath, checked: repos.includes(typedPath) } : null}
                onPick={(path) => setRepos((now) => toggleRepo(now, path))}
              />
            )}
          </ChipPopover>
          {repos.length > 1 ? (
            <ChipPopover field="branch" title={t("newSession.branches")} label={t("newSession.branches")}>
              {() => (
                <BranchesMenu
                  repos={branchRepos}
                  branch={branchName}
                  onBranch={setBranchName}
                  onBase={(path, ref) => setBases((now) => ({ ...now, [path]: ref }))}
                />
              )}
            </ChipPopover>
          ) : (
            probe?.ok &&
            branchLabel && (
              <ChipPopover field="branch" title={t("newSession.branch")} label={branchLabel}>
                {(close) => (
                  <SearchList
                    placeholder={t("newSession.branchSearch")}
                    empty={t("newSession.branchEmpty")}
                    rows={branchRows}
                    query={branchQuery}
                    onQuery={setBranchQuery}
                    onPick={(name) => {
                      setBases((now) => ({ ...now, [primary]: name }))
                      setBranchQuery("")
                      close()
                    }}
                  />
                )}
              </ChipPopover>
            )
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
      </form>
      {/* The rarer ways in sit under the card, out of the composer's own controls. */}
      <button
        type="button"
        className="composer-more"
        onClick={() => dialog.set(<NewTaskDialog model={model} repo={primary || undefined} />)}
      >
        {t("newSession.moreWays")}
      </button>
    </div>
  )
}
