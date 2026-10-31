/**
 * New session, claude.ai/code's way: the workspace shows an empty "New session" with the composer at
 * the bottom. Machine, project, worktree, branch and model/effort are chips under the prompt card; Start spawns
 * the task with that prompt, so the engine boots in the task's own tab-1 and no empty task exists in
 * between. With Worktree off the session runs in the project's own checkout, as a child of its main task.
 * Another machine's chip swaps the project list for that machine's, clones a repo it lacks there, and
 * starts the task through that machine's own daemon and credentials.
 */

import { deriveTitleFromPrompt } from "@sma1lboy/rove/src/orchestrator/title.ts"
import { useEffect, useRef, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import {
  MachineChip,
  RemoteBranchChip,
  remoteEmpty,
  spawnOnMachine,
  startError,
  usePrefetchRemoteRepos,
  useRemoteRepos,
} from "./new-session-machine.tsx"
import { BranchesMenu, ChipPopover, ChoiceMenu, ModelMenu, SearchList } from "./new-session-menus.tsx"
import { type RemotePick, remoteRef, seedRemotePick } from "./new-session-remote.ts"
import { RepoMenu } from "./new-session-repo-menu.tsx"
import { effortChoices, modelChipLabel, modelChoices, repoChipLabel, spawnArgs, toggleRepo } from "./new-session.ts"
import { NewTaskDialog, type ProbeResult } from "./new-task-dialog.tsx"
import { CLONE_PARENT_KEY, expandTilde, filterText, splitRepoRow, stripTrailingSlash } from "./new-task-paths.ts"
import { useStore } from "./store.ts"
import { useEngineChoice } from "./task-dialogs.tsx"
import { type NewSessionStart, dialog, newSession, openNewSession } from "./ui.ts"
import "./new-session.css"

/** New task: the composer, on this machine or the registered one the caller names. */
export function startNewTask(repo?: string, machine?: string): void {
  openNewSession(repo, undefined, machine)
}

const WORKTREE_KEY = "rove.web.newSession.worktree"

// The unsent prompt outlives the view: picking a task unmounts the composer, as switching chats does on claude.ai.
let promptDraft = ""

export function NewSessionView({ model, seed }: { model: AppModel; seed: NewSessionStart }) {
  const initialRepo = seed.repo
  useLocale()
  const selected = useStore(model.selection).taskId
  const fallback = model.tasks.get()?.tasks.find((task) => task.id === selected)?.repo
  const choice = useEngineChoice(model, initialRepo ?? fallback)
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
  const [progress, setProgress] = useState("")
  const [worktree, setWorktreeState] = useState(() => localStorage.getItem(WORKTREE_KEY) !== "0")
  const setWorktree = (on: boolean): void => {
    localStorage.setItem(WORKTREE_KEY, on ? "1" : "0")
    setWorktreeState(on)
  }
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  // Another registered machine ("" = this one): its project list, the pick there, and the ref to branch from.
  const machines = useMachines(model)
  const [machine, setMachine] = useState(seed.machine ?? "")
  const remote = machine !== ""
  const machineName = machines.find((m) => m.alias === machine)?.hostLabel || machine
  const remoteList = useRemoteRepos(model, machine)
  usePrefetchRemoteRepos(model, machines)
  const [remotePick, setRemotePick] = useState<RemotePick | null>(null)
  const [remoteBase, setRemoteBase] = useState("")

  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting project is read once
  useEffect(() => {
    void Promise.all([
      model.client.request<{ repos: string[] }>("repos.list"),
      model.client.request<{ home: string }>("fs.subdirs", { path: "~/" }),
    ])
      .then(([list, fs]) => {
        setSaved(list.repos)
        setHome(fs.home)
        // A project the opener named on another machine is a path there, not a project here.
        const start = (seed.machine ? undefined : initialRepo) ?? fallback ?? list.repos[0]
        setRepos((now) => (now.length > 0 || !start ? now : [start]))
        // The branch the opener chose applies to the project it chose.
        if (start && seed.baseBranch) setBases((now) => ({ ...now, [start]: seed.baseBranch ?? "" }))
      })
      .catch(() => {})
  }, [model, initialRepo])

  // Several repos always get worktrees: one checkout can't hold a multi-repo task.
  const inPlace = !remote && !worktree && repos.length === 1
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

  // The project a rail row named on another machine is picked once that machine's list is in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeded once per list load; a later pick or machine switch stands
  useEffect(() => {
    if (!remote || !remoteList.loaded || machine !== seed.machine) return
    setRemotePick((now) => now ?? seedRemotePick(initialRepo, remoteList.repos))
  }, [remoteList.loaded])

  useEffect(() => area.current?.focus(), [])

  const engine = choice.engines.find((e) => e.id === choice.engine)
  const models = modelChoices(engine, t("newSession.modelDefault"))
  const efforts = effortChoices(engine, t("newSession.effortDefault"))
  // A pick of the previous engine's model or level means nothing to this one.
  const modelValue = models.some((m) => m.id === pickedModel) ? pickedModel : ""
  const effortValue = efforts.some((e) => e.id === pickedEffort) ? pickedEffort : ""

  const cloneInto = async (source: string) => {
    setError(null)
    setBusy(true)
    setProgress(t("newSession.cloning", { source }))
    try {
      const parent = stripTrailingSlash(expandTilde((localStorage.getItem(CLONE_PARENT_KEY) || "~/").trim(), home))
      const res = await model.client.request<{ path: string }>(
        "repo.clone",
        { url: source, parentDir: parent },
        setProgress,
      )
      setSaved((now) => (now.includes(res.path) ? now : [...now, res.path]))
      setRepos((now) => (now.includes(res.path) ? now : toggleRepo(now, res.path)))
      setRepoQuery("")
    } catch (err) {
      setError(startError(err))
    } finally {
      setBusy(false)
      setProgress("")
    }
  }

  // On another machine `add` runs there: it clones a repo it lacks first, with its own credentials.
  const startRemote = async (begin: boolean) => {
    if (!remotePick) return setError(t("newSession.needRepo"))
    if (begin && !prompt.trim()) return setError(t("newSession.needPrompt"))
    setBusy(true)
    setProgress(
      remotePick.clone
        ? t("newSession.cloningOn", { source: remotePick.ref, machine: machineName })
        : t("newSession.startingOn", { machine: machineName }),
    )
    try {
      const created = await spawnOnMachine(model, {
        pick: remotePick,
        machine,
        engine: choice.engine,
        prompt: prompt.trim(),
        begin,
        baseRef: remoteBase,
      })
      promptDraft = ""
      newSession.set(null)
      if (created) model.selectWhenListed(created)
    } catch (err) {
      setError(startError(err))
    } finally {
      setBusy(false)
      setProgress("")
    }
  }

  // `begin` false creates the task without running its engine: no prompt needed.
  const start = async (begin = true) => {
    setError(null)
    if (remote) return startRemote(begin)
    if (!primary) return setError(t("newSession.needRepo"))
    if (begin && !prompt.trim()) return setError(t("newSession.needPrompt"))
    setBusy(true)
    try {
      // Every pick is re-probed: a typed path may not be a repo, and the daemon wants canonical roots.
      const fresh = await Promise.all(repos.map((path) => model.client.request<ProbeResult>("repo.probe", { path })))
      const bad = fresh.find((res) => !res.ok)
      if (bad) throw new Error(bad.reason ?? bad.repo)
      let created: string | undefined
      if (inPlace) {
        // The kanban "project" placement: a child of the main task, sharing the checkout as it is.
        const main = await model.client.request<{ taskId: string }>("task.openMain", {
          repo: fresh[0]?.repo ?? primary,
        })
        const res = await model.client.request<{ taskId?: string }>("tab.new", {
          taskId: main.taskId,
          kind: "engine",
          ...(choice.engine ? { engine: choice.engine } : {}),
          ...(begin ? { prompt: prompt.trim() } : {}),
        })
        created = res.taskId ?? main.taskId
        // A session that starts is titled from its first message; one that doesn't takes the prompt now.
        const title = !begin && res.taskId ? deriveTitleFromPrompt(prompt) : ""
        if (title) await model.client.request("task.rename", { taskId: res.taskId, title })
      } else {
        const res = await model.client.request<{ taskIds: string[] }>(
          "task.spawn",
          spawnArgs({
            repos: repos.map((path, i) => ({ repo: fresh[i]?.repo ?? path, baseRef: bases[path] ?? "" })),
            branch: branchName.trim(),
            engine: choice.engine,
            prompt: prompt.trim(),
            begin,
            model: modelValue,
            effort: effortValue,
          }),
        )
        created = res.taskIds[0]
      }
      promptDraft = ""
      newSession.set(null)
      if (created) model.selectWhenListed(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

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
        <div className="composer-card">
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
          <div className="composer-actions">
            <button type="button" className="composer-chip" disabled={busy} onClick={() => void start(false)}>
              {t("newSession.createOnly")}
            </button>
            <button type="submit" className="button" disabled={busy}>
              {t("newSession.start")}
            </button>
          </div>
        </div>
        <div className="composer-bar">
          <MachineChip
            machines={machines}
            value={machine}
            onPick={(alias) => {
              setMachine(alias)
              setRemotePick(null)
              setRemoteBase("")
              setRepoQuery("")
              setError(null)
            }}
          />
          <ChipPopover
            field="repo"
            title={
              !remote && repos.length > 1 ? t("newSession.repoCount", { count: repos.length }) : t("newSession.repo")
            }
            label={
              <>
                <FolderIcon />
                {(remote ? repoChipLabel(remotePick ? [remotePick.ref] : []) : repoChipLabel(repos)) ||
                  t("newSession.repo")}
                {remotePick?.clone && <span className="muted"> {t("newSession.cloneTag")}</span>}
              </>
            }
          >
            {(close) => (
              <RepoMenu
                model={model}
                saved={remote ? remoteList.repos.map(remoteRef) : saved}
                picked={remote ? (remotePick ? [remotePick.ref] : []) : repos}
                primary={remote ? "" : primary}
                home={remote ? "" : home}
                query={repoQuery}
                onQuery={setRepoQuery}
                onToggle={(path) => {
                  if (!remote) return setRepos((now) => toggleRepo(now, path))
                  setRemotePick({ ref: path, clone: false })
                  close()
                }}
                onClone={(source) => (remote ? setRemotePick({ ref: source, clone: true }) : void cloneInto(source))}
                close={close}
                remote={
                  remote
                    ? {
                        name: machineName,
                        empty: remoteEmpty(machine, remoteList),
                        blocked: remoteList.problem !== "",
                      }
                    : undefined
                }
              />
            )}
          </ChipPopover>
          {remote ? (
            remotePick && <RemoteBranchChip value={remoteBase} onPick={setRemoteBase} />
          ) : (
            <>
              <button
                type="button"
                className={`composer-chip composer-toggle ${inPlace ? "" : "is-on"}`}
                aria-pressed={!inPlace}
                disabled={repos.length > 1}
                title={
                  repos.length > 1
                    ? t("newSession.worktreeMulti")
                    : t(inPlace ? "newSession.worktreeOff" : "newSession.worktreeOn")
                }
                onClick={() => setWorktree(!worktree)}
              >
                <BranchIcon />
                {t("newSession.worktree")}
              </button>
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
                !inPlace &&
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
            </>
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
          {!inPlace && !remote && (models.length > 0 || efforts.length > 0) && (
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
        </div>
        {busy && progress && (
          <p className="muted" data-field="clone-progress">
            {progress}
          </p>
        )}
        {error && <p className="error">※ {error}</p>}
      </form>
      {/* The rarer ways in sit under the card, out of the composer's own controls; clone and adopt read this machine's disk. */}
      {!remote && (
        <button
          type="button"
          className="composer-more"
          onClick={() => dialog.set(<NewTaskDialog model={model} repo={primary || undefined} />)}
        >
          {t("newSession.moreWays")}
        </button>
      )}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg className="composer-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg className="composer-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" />
    </svg>
  )
}
