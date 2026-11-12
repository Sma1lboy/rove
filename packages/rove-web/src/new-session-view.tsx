/**
 * New session, claude.ai/code's way: the workspace shows an empty "New session" with the composer at
 * the bottom. Machine, project, worktree, branch and model are chips under the prompt card; Start spawns
 * the task with that prompt, so the engine boots in the task's own tab-1 and no empty task exists in
 * between. With Worktree off the session runs in the project's own checkout, as its own row in the project.
 * Another machine's chip swaps the project list for that machine's, clones a repo it lacks there, and
 * starts the task through that machine's own daemon and credentials.
 */

import { useEffect, useRef, useState } from "react"
import { AttachPicker, AttachmentThumbs, fileTargets, useAttachments, withRefs } from "./attachments.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { isTouch } from "./key-hints.ts"
import { openCompare } from "./layout.ts"
import type { AppModel } from "./model.ts"
import { BranchChips } from "./new-session-branch.tsx"
import { ATTACHMENTS_KEY, keepDraft, promptDraft } from "./new-session-draft.ts"
import { EngineChip, ModelChip, useEnginePicks } from "./new-session-engines.tsx"
import { FolderIcon } from "./new-session-icons.tsx"
import {
  ComposerNote,
  MachineChip,
  remoteEmpty,
  spawnOnMachine,
  startError,
  useRemoteTarget,
} from "./new-session-machine.tsx"
import { ChipPopover } from "./new-session-menus.tsx"
import { ComposerMore } from "./new-session-more.tsx"
import { NewSessionPlate } from "./new-session-plate.tsx"
import { remoteRef } from "./new-session-remote.ts"
import { RepoMenu } from "./new-session-repo-menu.tsx"
import {
  modelChoices,
  partialRoundId,
  repoChipLabel,
  spawnArgs,
  startInCheckout,
  startUngrouped,
  toggleRepo,
} from "./new-session.ts"
import type { ProbeResult } from "./new-task-dialog.tsx"
import { CLONE_PARENT_KEY, expandTilde, stripTrailingSlash } from "./new-task-paths.ts"
import { lastReply, requestRemembered } from "./remembered.ts"
import { retryCommandFrom, seededBases, seededRepos } from "./retry-seed.ts"
import { offerArchiveOriginal } from "./retry.tsx"
import { formatStartsAt } from "./schedule-start.ts"
import { useSnippetSuggest } from "./snippet-suggest.tsx"
import { useStore } from "./store.ts"
import { useEngineChoice } from "./task-dialogs.tsx"
import { type NewSessionStart, newSession, openNewSession, toast } from "./ui.ts"
import { buttonClass } from "./ui/button.tsx"
import * as C from "./ui/composer.ts"
import { CardMicFace, ClipGlyph, composerHold } from "./ui/term-composer.tsx"
import { DictationButton, talksFirst, useVoiceHosted } from "./voice/dictation-button.tsx"

/** New task: the composer, on this machine or the registered one the caller names. */
export function startNewTask(repo?: string, machine?: string): void {
  openNewSession(repo, undefined, machine)
}

/** New conversation with no folder: the composer opens on its "No folder" choice (the rail's Ungrouped +). */
export function startNewUngrouped(): void {
  openNewSession(undefined, undefined, undefined, undefined, true)
}

const WORKTREE_KEY = "rove.web.newSession.worktree"

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
    if (seed.prompt !== undefined) keepDraft(seed.prompt)
    return promptDraft()
  })
  const setPrompt = (text: string): void => {
    keepDraft(text)
    setPromptState(text)
  }
  const [pickedModel, setPickedModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [worktree, setWorktreeState] = useState(() => seed.worktree ?? localStorage.getItem(WORKTREE_KEY) !== "0")
  const setWorktree = (on: boolean): void => {
    localStorage.setItem(WORKTREE_KEY, on ? "1" : "0")
    setWorktreeState(on)
  }
  const [error, setError] = useState<string | null>(null)
  const lastTry = useRef<() => void>(() => {})
  const { attachments, attach, remove, ready, clear } = useAttachments(model, setError, ATTACHMENTS_KEY)
  const area = useRef<HTMLTextAreaElement>(null)
  const voiceHosted = useVoiceHosted(model.client)

  const talks = isTouch() && voiceHosted === true
  // Dictation lands at the caret and never submits: you read it before it goes anywhere.
  const insertDictated = (text: string) => {
    const el = area.current
    const at = el?.selectionStart ?? prompt.length
    const end = el?.selectionEnd ?? prompt.length
    const glue = at > 0 && !/\s$/.test(prompt.slice(0, at)) ? " " : ""
    setPrompt(`${prompt.slice(0, at)}${glue}${text}${prompt.slice(end)}`)
    const caret = at + glue.length + text.length
    requestAnimationFrame(() => {
      if (!talks) el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }
  // Another registered machine ("" = this one): its project list, the pick there, and the ref to branch from.
  const at = useRemoteTarget(model, { machine: seed.machine, repo: initialRepo }, choice)
  const { machines, machine, remote, machineName, remoteList, engineThere, shown } = at
  const { pick: remotePick, setPick: setRemotePick, base: remoteBase, setBase: setRemoteBase } = at
  // Files live on this Mac: another machine's task could not read them.
  const targets = remote ? null : fileTargets((files) => void attach(files))
  const engineId = shown.engine

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

  // Several repos always get worktrees: one checkout can't hold a multi-repo task. A folder without git has none.
  const plain = repos.some((path) => probes[path]?.git === false)
  const inPlace = !remote && (!worktree || plain) && repos.length === 1
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

  // A phone that talks first opens with the keyboard down, and keeps it down after a take.
  useEffect(() => {
    if (!talksFirst(model.client)) area.current?.focus()
  }, [model.client])

  // One attempt per engine needs a worktree each, on this machine, in a project.
  const compareAvailable = !remote && !ungrouped && !inPlace
  const picks = useEnginePicks(shown, compareAvailable)
  const engine = choice.engines.find((e) => e.id === engineId)
  const engineName = shown.engines.find((e) => e.id === engineId)?.name ?? engineId
  const models = modelChoices(engine, t("newSession.modelDefault"))
  // A pick of the previous engine's model means nothing to this one.
  const modelValue = models.some((m) => m.id === pickedModel) ? pickedModel : ""

  const cloneInto = async (source: string) => {
    lastTry.current = () => void cloneInto(source)
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
  const startRemote = async () => {
    if (!remotePick) return setError(t("newSession.needRepo"))
    if (!prompt.trim()) return setError(t("newSession.needPrompt"))
    const lacks = shown.missing?.has(engineId) && engineName
    if (lacks) return setError(t("newSession.engineMissingOn", { engine: lacks, machine: machineName }))
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
        engine: engineId,
        prompt: prompt.trim(),
        baseRef: remoteBase,
        engineThere,
        model: modelValue,
      })
      keepDraft("")
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

  // `at` holds the first message until then: the schedule is written with the task and the daemon starts it.
  const start = async (at?: Date) => {
    lastTry.current = () => void start(at)
    setError(null)
    if (remote) return startRemote()
    if (!primary && !ungrouped) return setError(t("newSession.needRepo"))
    if (!prompt.trim()) return setError(t("newSession.needPrompt"))
    setBusy(true)
    const first = withRefs(prompt.trim(), await ready())
    try {
      // Every pick is re-probed: a typed path may not be a repo, and the daemon wants canonical roots.
      const fresh = await Promise.all(repos.map((path) => model.client.request<ProbeResult>("repo.probe", { path })))
      const bad = fresh.find((res) => !res.ok)
      if (bad) throw new Error(bad.reason ?? bad.repo)
      const plainNow = fresh.some((res) => res.git === false)
      if (plainNow && fresh.length > 1) throw new Error(t("newSession.plainMulti"))
      let created: string | undefined
      let compared: string | undefined
      if (ungrouped) created = await startUngrouped(model.client.request.bind(model.client), engineId, prompt)
      else if (inPlace || plainNow)
        created = await startInCheckout(
          model.client.request.bind(model.client),
          fresh[0]?.repo ?? primary,
          engineId,
          prompt,
          first,
          at,
        )
      else {
        const res = await model.client.request<{ taskIds: string[]; groupId?: string }>(
          "task.spawn",
          spawnArgs({
            repos: repos.map((path, i) => ({ repo: fresh[i]?.repo ?? path, baseRef: bases[path] ?? "" })),
            branch: branchName.trim(),
            engine: engineId,
            commandFrom: retryCommandFrom(seed, engineId),
            engines: at ? [] : picks.ids,
            prompt: first,
            ...(at ? { at } : {}),
            model: modelValue,
          }),
        )
        created = res.taskIds[0]
        compared = res.groupId
      }
      if (at) toast(t("newSession.laterSet", { time: formatStartsAt(at) }))
      keepDraft("")
      clear()
      newSession.set(null)
      if (compared) openCompare(compared)
      else if (created) model.selectWhenListed(created)
      if (seed.retryOf && created) offerArchiveOriginal(model, seed.retryOf)
    } catch (err) {
      const round = partialRoundId(err)
      if (round) {
        // Some attempts did start: show them, with the failure, instead of leaving them unseen in the rail.
        keepDraft("")
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

  const pickMachine = (alias: string): void => {
    at.switchTo(alias, primary)
    setRepoQuery("")
    setError(null)
    setUngrouped(false)
  }

  return (
    <div className={C.NEW_SESSION}>
      <div className={C.HERO}>
        <NewSessionPlate />
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
            {targets && (
              <AttachPicker
                className={C.cardIcon(attachments.length > 0)}
                title={t("newSession.attachHint")}
                disabled={busy}
                onFiles={attach}
              >
                <span className="sr-only">{t("newSession.attach")}</span>
                <ClipGlyph />
              </AttachPicker>
            )}
            <DictationButton
              client={model.client}
              context={() => ({
                draft: [prompt.slice(-300), primary, branchName, remotePick?.ref ?? ""].filter(Boolean).join("\n"),
              })}
              onText={insertDictated}
              disabled={busy}
              look={talks ? composerHold : C.cardIcon}
              idle={talks ? t("voice.hold") : undefined}
              face={(state) => (
                <CardMicFace state={state} hold={talks} idle={t("voice.hold")} working={t("voice.working")} />
              )}
            />
            {!talks && <span className={C.GROW} />}
            <button type="submit" className={buttonClass()} disabled={busy}>
              {t("newSession.start")}
            </button>
          </div>
        </div>
        <div className={C.BAR}>
          <div className={C.BAR_GROUP}>
            {machines.length > 0 && <MachineChip machines={machines} value={machine} onPick={pickMachine} />}
            <ChipPopover
              field="repo"
              title={
                !remote && repos.length > 1 ? t("newSession.repoCount", { count: repos.length }) : t("newSession.repo")
              }
              label={
                <>
                  <FolderIcon />
                  {(remote ? repoChipLabel(remotePick ? [remotePick.ref] : []) : repoChipLabel(repos)) ||
                    t(ungrouped ? "newSession.noFolder" : "newSession.repo")}
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
                  onToggle={(path, add) => {
                    // "Pick a project first" is answered by this pick.
                    setError(null)
                    if (!remote) {
                      setUngrouped(false)
                      if (add) return setRepos((now) => toggleRepo(now, path))
                      setRepos([path])
                      return close()
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
              plain={plain}
              onToggleWorktree={() => setWorktree(!worktree)}
              repos={repos}
              probes={probes}
              bases={bases}
              onBase={(path, ref) => setBases((now) => ({ ...now, [path]: ref }))}
              branchName={branchName}
              onBranchName={setBranchName}
            />
          </div>
          <div className={C.BAR_GROUP_END}>
            <EngineChip choice={shown} picks={picks} available={compareAvailable} missing={shown.missing} />
            {!inPlace && !(remote && engineThere) && !ungrouped && !picks.comparing && models.length > 0 && (
              <ModelChip models={models} model={modelValue} onModel={setPickedModel} />
            )}
            <ComposerMore
              busy={busy}
              onLater={!remote && !ungrouped && !picks.comparing ? (at) => void start(at) : undefined}
              onInvalid={setError}
              agentPlace={remote ? { machine: machineName, there: engineThere, onPick: at.setEngineThere } : undefined}
            />
          </div>
        </div>
        <ComposerNote progress={busy ? progress : ""} error={error} busy={busy} onRetry={() => lastTry.current()} />
      </form>
    </div>
  )
}
