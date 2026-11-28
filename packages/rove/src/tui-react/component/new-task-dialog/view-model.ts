/**
 * New-task dialog state (JSX in `./dialog.tsx`): shared selectors, the
 * existing tab, key bindings and commit dispatch.
 *
 * Cursor resets live in the input handlers, not an effect on the filtered
 * lists: typing is the only thing that changes them. Submit-time error
 * strings use the module-level `t`.
 */

import { AUTO_ROUTING_TIERS, readAutoRoutingTable } from "@sma1lboy/rove-core/engine/auto-routing.ts"
import { engineEntry } from "@sma1lboy/rove-core/engine/registry.ts"
import { t } from "@sma1lboy/rove-core/i18n/index.ts"
import { type VendorId, nextVendorWithin, prevVendorWithin } from "@sma1lboy/rove-core/types/vendor.ts"
import type { AdoptableWorktree } from "@sma1lboy/rove-core/types/worktree.ts"
import { DEFAULT_BASE_REF, validateRepoPath } from "@sma1lboy/rove-core/worktree/git-snapshot.ts"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  type DialogTab,
  type ExistingIntent,
  type Field,
  type NewTaskInput,
  firstFieldFor,
  nextDialogTab,
  nextField,
  offersProjectIntent,
  pickerVisibleRows,
  prevDialogTab,
  stripNewlines,
} from "../../../tui/component/new-task-dialog/state"
import { useBindings } from "../../lib/keymap"
import { useTerminalSize } from "../../lib/use-terminal-size"
import { engineAcceptsModel, useModelField } from "../model-field"
import { resolveInitialVendor, resolveVendorSet } from "./pure"
import { useAdoptState } from "./use-adopt-state"
import { useBranchField } from "./use-branch-field"
import { useCloneState } from "./use-clone-state"
import { useExtraRepos } from "./use-extra-repos"
import { NO_FOLDER, useRepoField } from "./use-repo-field"

/** Prop surface of the dialog view. */
export type NewTaskDialogProps = {
  onSubmit: (v: NewTaskInput) => void
  onCancel: () => void
  defaultRepo: string
  /** User-curated repo list (`/add-repo`), cwd prepended by the picker. */
  savedRepos: readonly string[]
  /** Default parent dir for the Clone tab (kv `lastClonedRepoParent`). */
  defaultCloneParent?: string
  /** Engine to pre-select (kv `lastSelectedVendor`); `ctrl+e` cycles. */
  defaultVendor?: VendorId
  /** Vendors detected on this machine; empty falls back to all. */
  availableVendors?: readonly VendorId[]
  /** Adopt-tab discovery. Omit to leave the tab empty. */
  discoverAdoptable?: (repo: string) => Promise<readonly AdoptableWorktree[]>
  /** Repos that already have a project checkout — gates the intent choice. */
  mainRepos?: ReadonlySet<string>
  /** Seeds the base branch and keeps it through repo auto-sync. */
  initialBaseRef?: string
  /** The page's pane has focus (default true); without it no field is focused and no key is bound. */
  focused?: boolean
}

/** Stable default for `mainRepos` — a per-render `new Set()` defeats memos. */
const EMPTY_MAIN_REPOS: ReadonlySet<string> = new Set()

/** The tier chips: the three depths, then "manual" = pick the fields by hand. */
export const TIER_CHOICES = [...AUTO_ROUTING_TIERS, "manual"] as const
export type TierChoice = (typeof TIER_CHOICES)[number]

export function useNewTaskViewModel(props: NewTaskDialogProps) {
  const active = props.focused !== false

  const [tab, setTab] = useState<DialogTab>("existing")
  const vendors = resolveVendorSet(props.availableVendors)
  const [vendor, setVendor] = useState<VendorId>(() =>
    resolveInitialVendor(resolveVendorSet(props.availableVendors), props.defaultVendor),
  )
  // Open on the first message: type and Enter creates with the defaults below it.
  const [field, setField] = useState<Field>("prompt")
  // Raw pick, READ through the current engine: an undeclared level reads as
  // "engine default" (same rule as change-engine's `seedEffort`).
  const effortLevels = engineEntry(vendor).effortLevels ?? []
  const [effortPick, setEffortPick] = useState("")
  const effort = effortLevels.includes(effortPick) ? effortPick : ""
  // Auto-routing tier; table read once per open (state.json), row shown only
  // while configured. The tier reads "manual" once any filled field differs —
  // the label recorded on the task must describe what actually launches, or
  // it is noise as training data.
  const tierTable = useMemo(() => readAutoRoutingTable(), [])
  const [tierPick, setTierPick] = useState<TierChoice>("manual")
  const tierApplied = useRef<{ vendor: VendorId; effort: string; model: string } | null>(null)
  const [modelSeed, setModelSeed] = useState<{ vendor: VendorId; model: string; key: number } | null>(null)
  // Existing-tab intent. Defaults to "task"; the choice only RENDERS when the
  // picked repo already has a project checkout to open.
  const [intent, setIntent] = useState<ExistingIntent>("task")

  // Validation error shown inline on submit; cleared on any input edit.
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The task's first message (Existing tab): a task is born by it.
  const [prompt, setPrompt] = useState("")

  /* ── Field clusters (each owns one question the dialog asks) ── */

  // Live per render so a shrunk terminal re-windows the pickers instead of
  // clipping Create. No chrome reserve for effort/model rows: they don't
  // render here, and reserving for them drew over the footer at 120x40.
  const pickerRows = pickerVisibleRows(useTerminalSize().height)
  const modelField = useModelField({
    vendor,
    pickerRows,
    initial: modelSeed?.model,
    initialVendor: modelSeed?.vendor,
    seedKey: modelSeed?.key,
  })
  const applied = tierApplied.current
  const tier: TierChoice =
    tierPick !== "manual" &&
    applied &&
    applied.vendor === vendor &&
    applied.effort === effort &&
    applied.model === modelField.value.trim()
      ? tierPick
      : "manual"
  const repoField = useRepoField({
    defaultRepo: props.defaultRepo,
    savedRepos: props.savedRepos,
    pickerRows,
    focused: active && tab === "existing" && field === "repo",
    // Intent is per-repo; reset so the row doesn't describe the previous path.
    // Safety is `commitExisting`'s own `canOpenProject` guard.
    onChanged: () => setIntent("task"),
    onAnswered: (answer) => setField(advanceField("repo", answer.trim() === NO_FOLDER)),
  })
  const expandedRepo = repoField.expandedRepo
  // No folder opens a session in no project: no branch or extra repos to carry.
  const noFolder = tab === "existing" && repoField.repo.trim() === ""
  const effortChoices = effortLevels.length > 0 ? ["", ...effortLevels] : []
  const modelVisible = engineAcceptsModel(vendor)
  // Offered against the EXPANDED path: `mainRepos` holds absolute repo roots,
  // and a `~/`-typed entry would otherwise never match its own project.
  const canOpenProject = offersProjectIntent(expandedRepo, props.mainRepos ?? EMPTY_MAIN_REPOS)
  const branch = useBranchField({
    expandedRepo,
    pickerRows,
    defaultRepo: props.defaultRepo,
    initialBaseRef: props.initialBaseRef,
    onResolved: () => setField("confirm"),
    onPicked: () => setField("confirm"),
  })

  const extras = useExtraRepos({ savedRepos: props.savedRepos, primary: expandedRepo, pickerRows })

  const clone = useCloneState({
    defaultCloneParent: props.defaultCloneParent,
    vendor,
    modelEffort: effort || undefined,
    model: modelVisible ? modelField.value.trim() || undefined : undefined,
    tier: tier !== "manual" ? tier : undefined,
    onSubmit: props.onSubmit,
    setField,
    setSubmitError,
  })
  const adopt = useAdoptState({
    active: tab === "adopt",
    expandedRepo,
    vendor,
    discoverAdoptable: props.discoverAdoptable,
    onSubmit: props.onSubmit,
    setSubmitError,
  })

  /* ── Effects ── */

  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are the invalidation keys — any edit clears the inline error.
  useEffect(() => {
    setSubmitError(null)
  }, [repoField.repo, clone.cloneUrl, clone.cloneParent, clone.cloneFolder, adopt.adoptFilter])

  /* ── Commit paths ── */

  function commitExisting(): void {
    const model = modelVisible ? modelField.value.trim() : ""
    if (noFolder) {
      const firstMessage = prompt.trim()
      props.onSubmit({
        mode: "scratch",
        vendor,
        ...(firstMessage ? { prompt: firstMessage } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { modelEffort: effort } : {}),
      })
      return
    }
    const r = expandedRepo
    if (!r) return
    const reason = validateRepoPath(r)
    if (reason) {
      setSubmitError(reason)
      setField("repo")
      return
    }
    // "Open the project" runs in the repo's own checkout, so no baseRef.
    // `canOpenProject` is re-read from the CURRENT repo so `open` is never
    // sent for an unsaved path, even if a caller skips the intent reset in
    // `changeRepo`.
    if (intent === "project" && canOpenProject) {
      props.onSubmit({ mode: "open", repo: r, vendor })
      return
    }
    const b = branch.baseRef.trim() || DEFAULT_BASE_REF
    const firstMessage = prompt.trim()
    props.onSubmit({
      repo: r,
      baseRef: b,
      vendor,
      ...(effort ? { modelEffort: effort } : {}),
      ...(model ? { model } : {}),
      ...(tier !== "manual" ? { tier } : {}),
      ...(firstMessage ? { prompt: firstMessage } : {}),
      ...(extras.extraPicked.length > 0 ? { extraRepos: extras.extraPicked } : {}),
    })
  }

  /** Fill the three engine fields from a tier. A tier whose engine isn't
   *  available is refused with the inline error, never half-applied. */
  function pickTier(choice: TierChoice): void {
    if (choice === "manual") {
      setTierPick("manual")
      return
    }
    const target = tierTable?.[choice]
    if (!target) return
    if (!vendors.includes(target.engine)) {
      setSubmitError(t("newTask.error.tierUnavailable", { tier: t(`tasks.tier.${choice}`), engine: target.engine }))
      return
    }
    const nextEffort = target.effort ?? ""
    const nextModel = target.model ?? ""
    setVendor(target.engine)
    setEffortPick(nextEffort)
    setModelSeed((s) => ({ vendor: target.engine, model: nextModel, key: (s?.key ?? 0) + 1 }))
    tierApplied.current = { vendor: target.engine, effort: nextEffort, model: nextModel }
    setTierPick(choice)
    setSubmitError(null)
  }

  function cycleTier(dir: 1 | -1): void {
    const i = TIER_CHOICES.indexOf(tier)
    pickTier(TIER_CHOICES[(i + dir + TIER_CHOICES.length) % TIER_CHOICES.length] ?? "manual")
  }

  function commit(): void {
    if (tab === "clone") {
      void clone.commitClone()
      return
    }
    if (tab === "adopt") {
      adopt.commitAdopt()
      return
    }
    commitExisting()
  }

  /**
   * Which stops the Tab cycle offers. A stop on an unrendered field parks
   * focus on an invisible input and swallows every keystroke, so each is on
   * only while its row renders: effort for engines that declare levels, model
   * for engines with a model flag. Depth (auto-routing's) stays off. Shared by
   * `advanceField` and `advanceFieldFor` so tests walk the dialog's real cycle.
   */
  function focusStopsFor(forTab: DialogTab) {
    return {
      intentVisible: forTab === "existing" && canOpenProject,
      // Opening the project has no extras either: it enters the repo's own checkout.
      extrasVisible:
        forTab === "existing" &&
        !noFolder &&
        extras.extraCandidates.length > 0 &&
        !(intent === "project" && canOpenProject),
      effortVisible: effortChoices.length > 0,
      modelVisible,
      tierVisible: false,
    }
  }

  function advanceField(from: Field, toNoFolder = noFolder): Field {
    // No folder hides every stop between the repo and Create.
    if (toNoFolder && from === "repo") return "confirm"
    const next = nextField(from, tab, focusStopsFor(tab))
    // The "project" intent hides the first-message and branch fields; walk past each.
    if (tab !== "existing" || intent !== "project" || !canOpenProject) return next
    if (next === "prompt") return nextField("prompt", tab, focusStopsFor(tab))
    return next === "baseRef" ? "confirm" : next
  }

  /* ── Navigation / selection handlers ── */

  function switchToTab(next: DialogTab): void {
    if (clone.cloneInFlight || next === tab) return
    setTab(next)
    setField(firstFieldFor(next))
    setSubmitError(null)
  }

  // ←/→ on the mode selector: switch tab but KEEP focus on the selector.
  function cycleTab(dir: 1 | -1): void {
    if (clone.cloneInFlight) return
    const next = dir === 1 ? nextDialogTab(tab) : prevDialogTab(tab)
    if (next === tab) return
    setTab(next)
    setSubmitError(null)
    setField("tabs")
  }

  function cycleEngine(dir: 1 | -1): void {
    setVendor((v) => (dir === 1 ? nextVendorWithin(vendors, v) : prevVendorWithin(vendors, v)))
  }

  function stepEffort(dir: 1 | -1): void {
    if (effortChoices.length === 0) return
    const i = Math.max(0, effortChoices.indexOf(effort))
    setEffortPick(effortChoices[Math.max(0, Math.min(effortChoices.length - 1, i + dir))] ?? "")
  }

  /** Tab on a field with a suggestion open: complete first, advance only
   *  when nothing is left. Both path fields (repo, clone parent dir) obey it. */
  function completeFocusedField(): boolean {
    if (tab === "existing" && field === "repo") return repoField.completeRepo()
    if (tab === "clone" && field === "cloneParent") return clone.completeCloneParent()
    return false
  }

  // up/down over whichever picker the focused field drives.
  function moveCursor(delta: 1 | -1): void {
    if (clone.cloneInFlight) return
    if (field === "model") {
      modelField.moveCursor(delta)
      return
    }
    if (tab === "existing" && field === "extras") {
      extras.moveExtraCursor(delta)
      return
    }
    if (tab === "existing" && field === "repo") {
      repoField.moveRepoCursor(delta)
      return
    }
    if (tab === "existing" && field === "baseRef") {
      branch.moveBranchCursor(delta)
      return
    }
    if (tab === "clone" && field === "cloneParent") {
      clone.moveParentCursor(delta)
      return
    }
    if (tab === "adopt") adopt.moveAdoptCursor(delta)
  }

  /** ←/→ (and their h/l twins) on a selector field: cycle its value. */
  function stepSelector(dir: 1 | -1): void {
    if (field === "tabs") cycleTab(dir)
    else if (field === "tier") cycleTier(dir)
    else if (field === "engine") cycleEngine(dir)
    else if (field === "effort") stepEffort(dir)
    else setIntent(dir === 1 ? "project" : "task")
  }

  /* ── Key bindings (config re-evaluated per keypress — closures fresh) ── */

  useBindings(() => ({
    enabled: active,
    bindings: [
      {
        key: "escape",
        cmd: () => {
          if (tab === "existing" && field === "repo" && repoField.exitBrowse()) return
          props.onCancel()
        },
      },
      { key: "ctrl+c", cmd: () => props.onCancel() },
      ...(tab === "existing" && field === "repo" && repoField.mode === "folder-browse" && repoField.isSearchEmpty()
        ? [
            { key: "h" as const, cmd: () => void repoField.stepUpBrowse() },
            { key: "left" as const, cmd: () => void repoField.stepUpBrowse() },
            { key: "backspace" as const, cmd: () => void repoField.stepUpBrowse() },
            { key: "l" as const, cmd: () => void repoField.stepIntoBrowse() },
            { key: "right" as const, cmd: () => void repoField.stepIntoBrowse() },
          ]
        : []),
      {
        key: "tab",
        cmd: () => {
          if (!completeFocusedField()) setField(advanceField)
        },
      },
      // No RoveKeymap row: the page labels `MODE  ctrl+[ ]` itself.
      { key: "ctrl+]", cmd: () => switchToTab(nextDialogTab(tab)) },
      { key: "ctrl+[", cmd: () => switchToTab(prevDialogTab(tab)) },
      { key: "ctrl+e", cmd: () => cycleEngine(1) },
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "down", cmd: () => moveCursor(1) },
      // ←/→ (and h/l) / Enter ONLY while a selector is focused — an always-on
      // binding would preventDefault the keys away from focused text inputs.
      ...(field === "tabs" || field === "tier" || field === "engine" || field === "effort" || field === "intent"
        ? [
            { key: "left", cmd: () => stepSelector(-1) },
            { key: "right", cmd: () => stepSelector(1) },
            { key: "h", cmd: () => stepSelector(-1) },
            { key: "l", cmd: () => stepSelector(1) },
            { key: "return", cmd: () => setField(advanceField) },
          ]
        : []),
      // Ctrl+A select-all exists ONLY on the Adopt tab; elsewhere it must
      // fall through to the focused input as line-home.
      ...(tab === "adopt" ? [{ key: "ctrl+a", cmd: adopt.adoptSelectAll }] : []),
      // Enter on the extras list toggles the row under the cursor; Tab walks on.
      ...(field === "extras" ? [{ key: "return", cmd: extras.toggleExtraCursor }] : []),
    ],
  }))

  // Enter on Create — separate registration with config-level `enabled` so
  // it is OUT of the dispatch stack while another field holds focus.
  useBindings(() => ({
    enabled: active && field === "confirm" && !clone.cloneInFlight,
    bindings: [{ key: "return", cmd: () => commit() }],
  }))

  return {
    ...clone,
    ...adopt,
    ...branch,
    ...extras,
    ...repoField,
    defaultRepo: props.defaultRepo,
    tab,
    vendors,
    vendor,
    setVendor,
    effort,
    effortChoices,
    setEffort: setEffortPick,
    prompt,
    setPrompt: (v: string) => setPrompt(stripNewlines(v)),
    modelVisible,
    modelField,
    /** The tier row renders only while auto routing is configured. */
    tierVisible: tierTable !== null,
    tier,
    pickTier,
    /** The focused stop; none while the pane is unfocused, so no input holds the caret. */
    field: active ? field : undefined,
    setField,
    /** Enter inside an input that is not the tab's last stop: walk on. */
    advanceFrom: (from: Field) => setField(advanceField(from)),
    /** The focus walk without moving focus — observes THIS dialog's stops
     *  (shares `focusStopsFor` with `advanceField`). */
    advanceFieldFor: (from: Field, forTab: DialogTab = tab) => nextField(from, forTab, focusStopsFor(forTab)),
    noFolder,
    intent,
    setIntent,
    canOpenProject,
    submitError,
    switchToTab,
    commit,
    commitExisting,
  }
}

export type NewTaskVm = ReturnType<typeof useNewTaskViewModel>
