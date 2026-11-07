/**
 * New session, claude.ai/code's way: the workspace shows an empty "New session" with the composer at
 * the bottom. Machine, project, worktree, branch and model/effort are chips under the prompt card; Start spawns
 * the task with that prompt, so the engine boots in the task's own tab-1 and no empty task exists in
 * between. With Worktree off the session runs in the project's own checkout, as its own row in the project.
 * Another machine's chip swaps the project list for that machine's, clones a repo it lacks there, and
 * starts the task through that machine's own daemon and credentials.
 */

import { useEffect, useRef, useState } from "react"
import { AttachPicker, AttachmentThumbs, fileTargets, useAttachments, withRefs } from "./attachments.tsx"
import { DictationButton } from "./dictation-button.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { openCompare } from "./layout.ts"
import { useMachines } from "./machines-view.tsx"
import type { AppModel } from "./model.ts"
import { BranchChips } from "./new-session-branch.tsx"
import { EngineChip, ModelChip, useEnginePicks } from "./new-session-engines.tsx"
import { ClipIcon, FolderIcon } from "./new-session-icons.tsx"
import { LaterControl } from "./new-session-later.tsx"
import {
  MachineChip,
  remoteEmpty,
  spawnOnMachine,
  startError,
  usePrefetchRemoteRepos,
  useRemoteRepos,
} from "./new-session-machine.tsx"
import { ChipPopover } from "./new-session-menus.tsx"
import { type RemotePick, remoteRef, seedRemotePick } from "./new-session-remote.ts"
import { RepoMenu } from "./new-session-repo-menu.tsx"
import {
  effortChoices,
  modelChoices,
  partialRoundId,
  repoChipLabel,
  spawnArgs,
  startInCheckout,
  startUngrouped,
  toggleRepo,
} from "./new-session.ts"
import { NewTaskDialog, type ProbeResult } from "./new-task-dialog.tsx"
import { CLONE_PARENT_KEY, expandTilde, stripTrailingSlash } from "./new-task-paths.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { retryCommandFrom, seededBases, seededRepos } from "./retry-seed.ts"
import { offerArchiveOriginal } from "./retry.tsx"
import { formatStartsAt, scheduleCreated } from "./schedule-start.ts"
import { useSnippetSuggest } from "./snippet-suggest.tsx"
import { useStore } from "./store.ts"
import { useEngineChoice } from "./task-dialogs.tsx"
import { type NewSessionStart, dialog, newSession, openNewSession, toast } from "./ui.ts"
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
  const choice = useEngineChoice(model, initialRepo ?? fallback, seed.engine)
  // The starting project, known now when the opener or the selection names one; else the first saved, once read.
  const lastSaved = lastReply<{ repos: string[] }>(model, "repos.list")?.repos
  const startOf = (list?: readonly string[]) =>
    seed.ungrouped ? undefined : ((seed.machine ? undefined : initialRepo) ?? fallback ?? list?.[0])
  const [saved, setSaved] = useState<readonly string[]>(lastSaved ?? [])
  const [home, setHome] = useState(() => lastReply<{ home: string }>(model, "fs.subdirs", { path: "~/" })?.home ?? "")
  const [repos, setRepos] = useState<readonly string[]>(() => {
    return seededRepos(startOf(lastSaved), seed)
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
  const [bases, setBases] = useState<Readonly<Record<string, string>>>(() => seededBases(startOf(lastSaved), seed))
  const [branchName, setBranchName] = useState("")
  const [repoQuery, setRepoQuery] = useState("")
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
  const [worktree, setWorktreeState] = useState(() => seed.worktree ?? localStorage.getItem(WORKTREE_KEY) !== "0")
  const setWorktree = (on: boolean): void => {
    localStorage.setItem(WORKTREE_KEY, on ? "1" : "0")
    setWorktreeState(on)
  }
  const [error, setError] = useState<string | null>(null)
  const { attachments, attach, remove, clear } = useAttachments(model, setError)
  const area = useRef<HTMLTextAreaElement>(null)

  // Dictation lands at the caret and never submits: you read it before it goes anywhere.
  const insertDictated = (text: string) => {
    const el = area.current
    const at = el?.selectionStart ?? prompt.length
    const end = el?.selectionEnd ?? prompt.length
    const glue = at > 0 && !/\s$/.test(prompt.slice(0, at)) ? " " : ""
    setPrompt(`${prompt.slice(0, at)}${glue}${text}${prompt.slice(end)}`)
    const caret = at + glue.length + text.length
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }
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
        setRepos((now) => (now.length > 0 || !start ? now : seededRepos(start, seed)))
        // The branch the opener chose applies to the project it chose.
        setBases((now) => ({ ...now, ...seededBases(start, seed) }))
      })
      .catch(() => {})
  }, [model, initialRepo])

  // Several repos always get worktrees: one checkout can't hold a multi-repo task.
  const inPlace = !remote && !worktree && repos.length === 1
  const primary = repos[0] ?? ""
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

  // One attempt per engine needs a worktree each, on this machine, in a project.
  const compareAvailable = !remote && !ungrouped && !inPlace
  const picks = useEnginePicks(choice, compareAvailable)
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
      if (seed.retryOf && created) offerArchiveOriginal(model, seed.retryOf)
    } catch (err) {
      setError(startError(err))
    } finally {
      setBusy(false)
      setProgress("")
    }
  }

  // `begin` false creates the task without running its engine: no prompt needed.
  // `at` holds the first message until then: the task is created unstarted and the daemon starts it.
  const start = async (begin = true, at?: Date) => {
    setError(null)
    if (remote) return startRemote(begin)
    if (!primary && !ungrouped) return setError(t("newSession.needRepo"))
    if ((begin || at) && !prompt.trim()) return setError(t("newSession.needPrompt"))
    setBusy(true)
    const first = withRefs(prompt.trim(), attachments)
    try {
      // Every pick is re-probed: a typed path may not be a repo, and the daemon wants canonical roots.
      const fresh = await Promise.all(repos.map((path) => model.client.request<ProbeResult>("repo.probe", { path })))
      const bad = fresh.find((res) => !res.ok)
      if (bad) throw new Error(bad.reason ?? bad.repo)
      let created: string | undefined
      let compared: string | undefined
      if (ungrouped)
        created = await startUngrouped(model.client.request.bind(model.client), choice.engine, prompt, begin)
      else if (inPlace)
        created = await startInCheckout(
          model.client.request.bind(model.client),
          fresh[0]?.repo ?? primary,
          choice.engine,
          prompt,
          begin,
          first,
        )
      else {
        const res = await model.client.request<{ taskIds: string[]; groupId?: string }>(
          "task.spawn",
          spawnArgs({
            repos: repos.map((path, i) => ({ repo: fresh[i]?.repo ?? path, baseRef: bases[path] ?? "" })),
            branch: branchName.trim(),
            engine: choice.engine,
            commandFrom: retryCommandFrom(seed, choice.engine),
            engines: begin ? picks.ids : [],
            prompt: first,
            begin,
            model: modelValue,
            effort: effortValue,
          }),
        )
        created = res.taskIds[0]
        compared = res.groupId
      }
      if (at && created) {
        await scheduleCreated(model.client, created, at, first)
          .then(() => toast(t("newSession.laterSet", { time: formatStartsAt(at) })))
          .catch((err) => toast(startError(err), "error"))
      }
      promptDraft = ""
      clear()
      newSession.set(null)
      if (compared) openCompare(compared)
      else if (created) model.selectWhenListed(created)
      if (seed.retryOf && created) offerArchiveOriginal(model, seed.retryOf)
    } catch (err) {
      const round = partialRoundId(err)
      if (round) {
        // Some attempts did start: show them, with the failure, instead of leaving them unseen in the rail.
        promptDraft = ""
        clear()
        newSession.set(null)
        toast(err instanceof Error ? err.message : String(err), "error")
        openCompare(round)
      } else setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const snippets = useSnippetSuggest({ value: prompt, onChange: setPrompt, area, onEnter: () => void start() })

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
          {!remote && <AttachmentThumbs attachments={attachments} onRemove={remove} />}
          <textarea
            ref={area}
            className={C.PROMPT}
            rows={4}
            spellCheck={false}
            placeholder={t("newSession.placeholder")}
            value={prompt}
            disabled={busy}
            onPaste={targets?.onPaste}
            {...snippets.field}
          />
          {snippets.list}
          <div className={C.CARD_ACTIONS}>
            <button
              type="button"
              className={C.chipClass()}
              disabled={busy || picks.comparing}
              title={picks.comparing ? t("compare.needsPrompt") : undefined}
              onClick={() => void start(false)}
            >
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
                  // "Pick a project first" is answered by this pick.
                  setError(null)
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
          <BranchChips
            remote={remote}
            remotePick={remotePick}
            remoteBase={remoteBase}
            onRemoteBase={setRemoteBase}
            ungrouped={ungrouped}
            inPlace={inPlace}
            onToggleWorktree={() => setWorktree(!worktree)}
            repos={repos}
            probes={probes}
            bases={bases}
            onBase={(path, ref) => setBases((now) => ({ ...now, [path]: ref }))}
            branchName={branchName}
            onBranchName={setBranchName}
          />
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
          {!remote && !ungrouped && !picks.comparing && (
            <LaterControl disabled={busy} onSchedule={(at) => void start(false, at)} onInvalid={setError} />
          )}
          <DictationButton
            client={model.client}
            context={() => [primary, branchName, remotePick?.ref ?? "", prompt.slice(-120)].filter(Boolean).join(" · ")}
            onText={insertDictated}
            disabled={busy}
          />
          <span className={C.GROW} />
          <EngineChip choice={choice} picks={picks} available={compareAvailable} />
          {!inPlace && !remote && !ungrouped && !picks.comparing && (models.length > 0 || efforts.length > 0) && (
            <ModelChip
              models={models}
              model={modelValue}
              onModel={setPickedModel}
              efforts={efforts}
              effort={effortValue}
              onEffort={setPickedEffort}
            />
          )}
        </div>
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
