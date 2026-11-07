/**
 * The TUI's new-task dialog (`tui-react/component/new-task-dialog`): three modes (Existing,
 * New Repo, Adopt Worktree) in one frame, Ctrl+[ / Ctrl+] switch the mode, Ctrl+E cycles the
 * engine. Copy comes from the TUI's own `newTask` catalog. This machine's disk only: another
 * machine's task starts from the composer.
 */

import { useEffect, useRef, useState } from "react"
import { ChipRow } from "./chip-row.tsx"
import { DialogActions, DialogShell, useSubmit } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import {
  filterText,
  isPathInput,
  joinDrill,
  joinPicked,
  nameOrPath,
  resolveRepo,
  splitRepoRow,
} from "./new-task-paths.ts"
import { AdoptTab, CloneTab } from "./new-task-tabs.tsx"
import { lastReply, requestRemembered } from "./remembered.ts"
import { SuggestField, type Suggestion, focusField } from "./suggest-field.tsx"
import { EnginePicker, useEngineChoice } from "./task-dialogs.tsx"
import { tc } from "./tui-copy.ts"
import { openNewSession } from "./ui.ts"
import { FIELD } from "./ui/form.ts"
import { DIALOG_BODY } from "./ui/overlay.ts"
import { HINT, KICKER } from "./ui/text.ts"

const TABS = ["existing", "clone", "adopt"] as const
export type NewTaskTab = (typeof TABS)[number]

export interface ProbeResult {
  readonly ok: boolean
  readonly repo: string
  readonly reason?: string
  readonly branches?: readonly string[]
  readonly current?: string | null
  readonly worktrees?: readonly AdoptableRow[]
}

export interface AdoptableRow {
  readonly path: string
  readonly branch: string
  readonly dirty: boolean | null
  readonly roveManaged: boolean
}

/** The repo field and everything derived from it, shared by the Existing and Adopt modes. */
export interface RepoField {
  readonly text: string
  readonly saved: readonly string[]
  readonly home: string
  readonly expanded: string
  readonly ambiguous: string | null
  readonly mainRepos: ReadonlySet<string>
  readonly open: boolean
  readonly items: readonly Suggestion[]
  readonly probe: ProbeResult | null
  readonly setText: (value: string) => void
  readonly pick: (index: number) => void
  readonly complete: (index: number) => boolean
  readonly reopen: () => void
}

interface Browse {
  readonly base: string
  readonly names: readonly string[]
}

function useRepoField(model: AppModel, initial: string | undefined): RepoField {
  const lastSaved = lastReply<{ repos: string[] }>(model, "repos.list")?.repos
  const [saved, setSaved] = useState<readonly string[]>(lastSaved ?? [])
  const [home, setHome] = useState(() => lastReply<{ home: string }>(model, "fs.subdirs", { path: "~/" })?.home ?? "")
  const [text, setTextState] = useState(() => {
    const start = initial ?? lastSaved?.[0]
    return start ? nameOrPath(start, lastSaved ?? []) : ""
  })
  const [picked, setPicked] = useState(false)
  const [browse, setBrowse] = useState<Browse | null>(null)
  const [probe, setProbe] = useState<ProbeResult | null>(null)

  useEffect(() => {
    void Promise.all([
      requestRemembered<{ repos: string[] }>(model, "repos.list"),
      requestRemembered<{ home: string }>(model, "fs.subdirs", { path: "~/" }),
    ])
      .then(([repos, fs]) => {
        setSaved(repos.repos)
        setHome(fs.home)
        const start = initial ?? repos.repos[0] ?? ""
        setTextState((now) => now || nameOrPath(start, repos.repos))
      })
      .catch(() => {})
  }, [model, initial])

  const browsing = isPathInput(text.trim()) && !saved.includes(text.trim())
  useEffect(() => {
    if (!browsing) return
    let stale = false
    const timer = setTimeout(() => {
      void model.client
        .request<{ base: string; names: string[] }>("fs.subdirs", { path: text })
        .then((res) => !stale && setBrowse({ base: res.base, names: res.names }))
        .catch(() => !stale && setBrowse({ base: "", names: [] }))
    }, 60)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [model, browsing, text])

  const resolution = resolveRepo(text, saved)
  const trimmed = resolution.kind === "path" ? resolution.path : ""
  const expanded = trimmed.startsWith("~") && !home ? "" : trimmed.replace(/^~(?=\/|$)/, home).replace(/(.)\/+$/, "$1")

  useEffect(() => {
    setProbe(null)
    if (!expanded) return
    let stale = false
    const timer = setTimeout(() => {
      void model.client
        .request<ProbeResult>("repo.probe", { path: expanded })
        .then((res) => !stale && setProbe(res))
        .catch(() => {})
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [model, expanded])

  const mainRepos = new Set(
    (model.tasks.get()?.tasks ?? [])
      .filter((task) => task.kind === "main")
      .map((task) => task.repo.replace(/\/+$/, "")),
  )
  const names = browsing ? (browse?.names ?? []) : []
  const savedRows = filterText(saved, text)
  const items: readonly Suggestion[] = browsing
    ? names.map((name) => ({ key: name, text: `${name}/` }))
    : savedRows.map((path) => {
        const { base, dir } = splitRepoRow(path)
        return { key: path, text: base, dim: dir, accent: path === expanded }
      })

  const setText = (value: string) => {
    setPicked(false)
    setTextState(value)
  }
  const pick = (index: number) => {
    if (browsing) {
      const name = names[index]
      if (name !== undefined) setTextState(joinPicked(text, browse?.base ?? "", name, home))
    } else {
      const path = savedRows[index]
      if (path !== undefined) setTextState(nameOrPath(path, saved))
    }
    setPicked(true)
    focusField("branch")
  }
  const complete = (index: number): boolean => {
    if (picked) return false
    if (browsing) {
      const name = names[index]
      if (name === undefined) return false
      const next = joinDrill(text, browse?.base ?? "", name, home)
      if (next === text) return false
      setTextState(next)
      return true
    }
    const path = savedRows[index]
    if (path === undefined) return false
    const next = nameOrPath(path, saved)
    if (next === text.trim()) return false
    setTextState(next)
    setPicked(true)
    return true
  }

  return {
    text,
    saved,
    home,
    expanded,
    ambiguous: resolution.kind === "ambiguous" ? resolution.name : null,
    mainRepos,
    open: !picked,
    items,
    probe,
    setText,
    pick,
    complete,
    reopen: () => setPicked(false),
  }
}

export interface TabProps {
  readonly model: AppModel
  readonly engine: string
  readonly busy: boolean
  readonly error: string | null
  readonly setError: (message: string | null) => void
  readonly run: (action: () => Promise<void>) => Promise<void>
}

function ExistingTab(props: TabProps & { repo: RepoField }) {
  const { model, repo } = props
  const [baseRef, setBaseRef] = useState("")
  const [touched, setTouched] = useState(false)
  const [branchOpen, setBranchOpen] = useState(true)
  const [intent, setIntent] = useState<"task" | "project">("task")
  const canOpenProject = repo.mainRepos.has(repo.expanded)
  const probe = repo.probe?.ok ? repo.probe : null
  const branches = probe?.branches ?? []

  // The ref follows the repo's current branch until typed over (the TUI's baseRef sync).
  useEffect(() => {
    if (!touched && probe?.current) setBaseRef(probe.current)
  }, [touched, probe])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different repo resets the choice
  useEffect(() => setIntent("task"), [repo.expanded])

  const filtered = filterText(branches, baseRef)
  const create = (ref?: string) =>
    props.run(async () => {
      if (repo.ambiguous) {
        repo.reopen()
        focusField("repo")
        throw new Error(tc("newTask", "error.repoAmbiguous", { name: repo.ambiguous }))
      }
      if (!repo.expanded) {
        focusField("repo")
        throw new Error(t("newTask.needRepo"))
      }
      const fresh = await model.client.request<ProbeResult>("repo.probe", { path: repo.expanded })
      if (!fresh.ok) {
        focusField("repo")
        throw new Error(fresh.reason ?? repo.expanded)
      }
      if (intent === "project" && canOpenProject) {
        const res = await model.client.request<{ taskId: string }>("task.openMain", { repo: fresh.repo })
        model.selectWhenListed(res.taskId)
        return
      }
      // A task is born by its first prompt: the composer takes the project and branch from here.
      openNewSession(fresh.repo, (ref ?? baseRef).trim())
    })

  const enterBranch = (index: number) => {
    const typed = baseRef.trim()
    const exact = typed ? filtered.find((name) => name.toLowerCase() === typed.toLowerCase()) : undefined
    void create(exact ?? filtered[index] ?? typed)
  }

  return (
    <form
      className={DIALOG_BODY}
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <div className={FIELD}>
        <span className={`${KICKER} text-muted`}>{tc("newTask", "field.repo")}</span>
        <SuggestField
          field="repo"
          value={repo.text}
          onChange={repo.setText}
          items={repo.items}
          open={repo.open}
          onPick={repo.pick}
          onComplete={repo.complete}
          onEnter={() => focusField("branch")}
        />
      </div>
      {canOpenProject && (
        <div className={FIELD}>
          <span className={`${KICKER} text-muted`}>{tc("newTask", "field.opens")}</span>
          <ChipRow
            label={tc("newTask", "field.opens")}
            field="intent"
            value={intent}
            onChange={(id) => setIntent(id === "project" ? "project" : "task")}
            choices={[
              { id: "task", label: tc("newTask", "intent.task") },
              { id: "project", label: tc("newTask", "intent.project") },
            ]}
          />
        </div>
      )}
      {!(intent === "project" && canOpenProject) && (
        <div className={FIELD}>
          <span className={`${KICKER} text-muted`}>{tc("newTask", "field.fromBranch")}</span>
          <SuggestField
            field="branch"
            value={baseRef}
            placeholder="main"
            onChange={(value) => {
              setTouched(true)
              setBranchOpen(true)
              setBaseRef(value)
            }}
            items={filtered.map((name) => ({ key: name, text: name, accent: name === baseRef.trim() }))}
            open={branchOpen}
            onPick={(index) => {
              const name = filtered[index]
              if (name === undefined) return
              setBaseRef(name)
              setTouched(true)
              setBranchOpen(false)
              focusField("create")
            }}
            onEnterRow={enterBranch}
            onEnter={() => void create()}
          />
          {filtered.length === 0 && props.error == null && (
            <span className="text-muted">
              {tc("newTask", branches.length === 0 ? "hint.noBranchesFound" : "hint.noMatchBranch")}
            </span>
          )}
        </div>
      )}
      {props.error && <p className="text-error">※ {props.error}</p>}
      <DialogActions busy={props.busy} submitLabel={tc("newTask", "button.create")} />
    </form>
  )
}

export function NewTaskDialog({ model, repo: initialRepo }: { model: AppModel; repo?: string }) {
  useLocale()
  const [tab, setTab] = useState<NewTaskTab>("existing")
  const { busy, error, setError, submit } = useSubmit()
  const selected = model.selection.get().taskId
  const fallback = model.tasks.get()?.tasks.find((task) => task.id === selected)?.repo
  const choice = useEngineChoice(model, initialRepo ?? fallback)
  const repo = useRepoField(model, initialRepo ?? fallback)
  const root = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a mode switch clears the last refusal
  useEffect(() => {
    setError(null)
    if (first.current) {
      first.current = false
      root.current?.querySelector<HTMLElement>("[data-field=mode] [aria-pressed=true]")?.focus()
      return
    }
    focusField(tab === "existing" ? "repo" : tab === "clone" ? "url" : "filter")
  }, [tab])

  const ready = choice.engines.filter((engine) => engine.ready !== false)
  const cycleEngine = () => {
    const pool = ready.length > 0 ? ready : choice.engines
    const at = pool.findIndex((engine) => engine.id === choice.engine)
    const next = pool[(at + 1) % pool.length]
    if (next) choice.setEngine(next.id)
  }
  const stepTab = (dir: 1 | -1) =>
    setTab((now) => TABS[(TABS.indexOf(now) + dir + TABS.length) % TABS.length] as NewTaskTab)

  const common = { model, engine: choice.engine, busy, error, setError, run: submit }
  return (
    <DialogShell title={tc("newTask", "title")} wide>
      {/* Chords are the TUI's: mode ctrl+[ ], engine ctrl+e (select-all ctrl+a lives in the adopt list). */}
      <div
        ref={root}
        onKeyDown={(e) => {
          if (!e.ctrlKey || e.metaKey || e.altKey) return
          if (e.key === "]" || e.key === "[") stepTab(e.key === "]" ? 1 : -1)
          else if (e.key.toLowerCase() === "e" && !e.shiftKey) cycleEngine()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className={DIALOG_BODY}>
          <div className={FIELD}>
            <span className={`${KICKER} text-muted`}>{tc("newTask", "field.mode")}</span>
            <ChipRow
              label={tc("newTask", "field.mode")}
              field="mode"
              value={tab}
              onChange={(id) => setTab(id as NewTaskTab)}
              choices={TABS.map((id) => ({ id, label: tc("newTask", `tabs.${id}`) }))}
            />
          </div>
          <div className={FIELD}>
            <span className={`${KICKER} text-muted`}>{tc("newTask", "field.engine")}</span>
            <EnginePicker engines={choice.engines} value={choice.engine} onChange={choice.setEngine} />
          </div>
        </div>
        <div hidden={tab !== "existing"}>
          <ExistingTab {...common} repo={repo} />
        </div>
        <div hidden={tab !== "clone"}>
          <CloneTab {...common} />
        </div>
        <div hidden={tab !== "adopt"}>
          <AdoptTab {...common} repo={repo} active={tab === "adopt"} />
        </div>
        <p className={`keys-only mx-0 mt-2 mb-0 ${HINT}`}>
          {tc("newTask", "legend", { enter: tc("newTask", "enterNext") })}
        </p>
      </div>
    </DialogShell>
  )
}
