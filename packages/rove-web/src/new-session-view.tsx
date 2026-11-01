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
import { AttachPicker, AttachmentChips, fileTargets, useAttachments, withRefs } from "./attachments.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { BranchIcon, ClipIcon, FolderIcon } from "./new-session-icons.tsx"
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
import {
  effortChoices,
  modelChipLabel,
  modelChoices,
  repoChipLabel,
  spawnArgs,
  startUngrouped,
  toggleRepo,
} from "./new-session.ts"
import { NewTaskDialog, type ProbeResult } from "./new-task-dialog.tsx"
import { CLONE_PARENT_KEY, expandTilde, filterText, splitRepoRow, stripTrailingSlash } from "./new-task-paths.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { useStore } from "./store.ts"
import { useEngineChoice } from "./task-dialogs.tsx"
import { type NewSessionStart, dialog, newSession, openNewSession } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import * as C from "./ui/composer.ts"

/** New task: the composer, on this machine or the registered one the caller names. */
export function startNewTask(repo?: string, machine?: string): void {
  openNewSession(repo, undefined, machine)
}

/** New conversation with no folder: the composer opens on its "No folder" choice (the rail's Ungrouped +). */
export function startNewUngrouped(): void {
  openNewSession(undefined, undefined, undefined, undefined, true)
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
  // The starting project, known now when the opener or the selection names one; else the first saved, once read.
  const lastSaved = lastReply<{ repos: string[] }>(model, "repos.list")?.repos
  const startOf = (list?: readonly string[]) =>
    seed.ungrouped ? undefined : ((seed.machine ? undefined : initialRepo) ?? fallback ?? list?.[0])
  const [saved, setSaved] = useState<readonly string[]>(lastSaved ?? [])
  const [home, setHome] = useState(() => lastReply<{ home: string }>(model, "fs.subdirs", { path: "~/" })?.home ?? "")
  const [repos, setRepos] = useState<readonly string[]>(() => {
    const start = startOf(lastSaved)
    return start ? [start] : []
  })
  // Each picked repo's branches: the last probe at once, reread when it is picked.
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult>>>(() =>
    Object.fromEntries(
      repos.flatMap((path) => {
        const last = lastReply<ProbeResult>(model, "repo.probe", { path })
        return last ? [[path, last]] : []
      }),
    ),
  )
  const probed = useRef(new Set<string>())
  // The rail's Ungrouped: a session in no project, exclusive with `repos`.
  const [ungrouped, setUngrouped] = useState(seed.ungrouped === true)
  const pickUngrouped = (): void => {
    setUngrouped(true)
    setRepos([])
  }
  // The ref each repo's worktree branches from ("" = its current branch), and the one branch name they share.
  const [bases, setBases] = useState<Readonly<Record<string, string>>>(() => {
    const start = startOf(lastSaved)
    return start && seed.baseBranch ? { [start]: seed.baseBranch } : {}
  })
  const [branchName, setBranchName] = useState("")
  const [repoQuery, setRepoQuery] = useState("")
  const [branchQuery, setBranchQuery] = useState("")
  // A link's `?prompt=` lands here as a draft to read and edit; nothing starts until Start is pressed.
  const [prompt, setPromptState] = useState(() => {
    if (seed.prompt !== undefined) promptDraft = seed.prompt
    return promptDraft
  })
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
  const { attachments, attach, remove, clear } = useAttachments(model, setError)
  const area = useRef<HTMLTextAreaElement>(null)
  // Another registered machine ("" = this one): its project list, the pick there, and the ref to branch from.
  const machines = useMachines(model)
  const [machine, setMachine] = useState(seed.machine ?? "")
  const remote = machine !== ""
  // Files live on this Mac: another machine's task could not read them.
  const targets = remote ? null : fileTargets((files) => void attach(files))
  const machineName = machines.find((m) => m.alias === machine)?.hostLabel || machine
  const remoteList = useRemoteRepos(model, machine)
  usePrefetchRemoteRepos(model, machines)
  const [remotePick, setRemotePick] = useState<RemotePick | null>(null)
  const [remoteBase, setRemoteBase] = useState("")

  // biome-ignore lint/correctness/useExhaustiveDependencies: the starting project is read once
  useEffect(() => {
    void Promise.all([
      requestRemembered<{ repos: string[] }>(model, "repos.list"),
      requestRemembered<{ home: string }>(model, "fs.subdirs", { path: "~/" }),
    ])
      .then(([list, fs]) => {
        setSaved(list.repos)
        setHome(fs.home)
        // A project the opener named on another machine is a path there, not a project here.
        const start = startOf(list.repos)
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
  // Each repo is reread once per open, when first picked.
  useEffect(() => {
    for (const path of repos) {
      if (probed.current.has(path)) continue
      probed.current.add(path)
      void requestRemembered<ProbeResult>(model, "repo.probe", { path })
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
      setUngrouped(false)
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
    if (!primary && !ungrouped) return setError(t("newSession.needRepo"))
    if (begin && !prompt.trim()) return setError(t("newSession.needPrompt"))
    setBusy(true)
    const first = withRefs(prompt.trim(), attachments)
    try {
      // Every pick is re-probed: a typed path may not be a repo, and the daemon wants canonical roots.
      const fresh = await Promise.all(repos.map((path) => model.client.request<ProbeResult>("repo.probe", { path })))
      const bad = fresh.find((res) => !res.ok)
      if (bad) throw new Error(bad.reason ?? bad.repo)
      let created: string | undefined
      if (ungrouped)
        created = await startUngrouped(model.client.request.bind(model.client), choice.engine, prompt, begin)
      else if (inPlace) {
        // The kanban "project" placement: a child of the main task, sharing the checkout as it is.
        const main = await model.client.request<{ taskId: string }>("task.openMain", {
          repo: fresh[0]?.repo ?? primary,
        })
        const res = await model.client.request<{ taskId?: string }>("tab.new", {
          taskId: main.taskId,
          kind: "engine",
          ...(choice.engine ? { engine: choice.engine } : {}),
          ...(begin ? { prompt: first } : {}),
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
            prompt: first,
            begin,
            model: modelValue,
            effort: effortValue,
          }),
        )
        created = res.taskIds[0]
      }
      promptDraft = ""
      clear()
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
    <div className={C.NEW_SESSION}>
      <div className={C.HERO}>
        <h1 className="m-0 font-sans text-title font-semibold text-accent">{t("newSession.title")}</h1>
        <p className="m-0 text-muted">{t("newSession.tagline")}</p>
      </div>
      <form
        className={C.COMPOSER}
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <div className={C.CARD} {...targets?.drop}>
          <textarea
            ref={area}
            className={C.PROMPT}
            rows={4}
            spellCheck={false}
            placeholder={t("newSession.placeholder")}
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            onPaste={targets?.onPaste}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
              e.preventDefault()
              void start()
            }}
          />
          <div className={C.CARD_ACTIONS}>
            <button type="button" className={C.chipClass()} disabled={busy} onClick={() => void start(false)}>
              {t("newSession.createOnly")}
            </button>
            <button type="submit" className={buttonClass()} disabled={busy}>
              {t("newSession.start")}
            </button>
          </div>
        </div>
        <div className={C.BAR}>
          <MachineChip
            machines={machines}
            value={machine}
            onPick={(alias) => {
              setMachine(alias)
              setRemotePick(null)
              setRemoteBase("")
              setRepoQuery("")
              setError(null)
              setUngrouped(false)
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
                  t(ungrouped ? "rail.noProject" : "newSession.repo")}
                {remotePick?.clone && <span className="text-muted"> {t("newSession.cloneTag")}</span>}
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
                  if (!remote) {
                    setUngrouped(false)
                    return setRepos((now) => toggleRepo(now, path))
                  }
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
                ungrouped={remote ? undefined : { on: ungrouped, pick: pickUngrouped }}
              />
            )}
          </ChipPopover>
          {ungrouped ? null : remote ? (
            remotePick && <RemoteBranchChip value={remoteBase} onPick={setRemoteBase} />
          ) : (
            <>
              <button
                type="button"
                className={`${C.chipClass(!inPlace)} ${C.TOGGLE_DISABLED}`}
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
          {targets && (
            <AttachPicker
              className={`${C.chipClass(attachments.length > 0)} cursor-pointer`}
              title={t("newSession.attachHint")}
              disabled={busy}
              onFiles={(files) => void attach(files)}
            >
              <ClipIcon />
              {t("newSession.attach")}
            </AttachPicker>
          )}
          <span className={C.GROW} />
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
          {!inPlace && !remote && !ungrouped && (models.length > 0 || efforts.length > 0) && (
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
        {!remote && <AttachmentChips attachments={attachments} onRemove={remove} />}
        {busy && progress && (
          <p className="text-muted" data-field="clone-progress">
            {progress}
          </p>
        )}
        {error && <p className="text-error">※ {error}</p>}
      </form>
      {/* The rarer ways in sit under the card, out of the composer's own controls; clone and adopt read this machine's disk. */}
      {!remote && (
        <button
          type="button"
          className={C.MORE}
          onClick={() => dialog.set(<NewTaskDialog model={model} repo={primary || undefined} />)}
        >
          {t("newSession.moreWays")}
        </button>
      )}
    </div>
  )
}
