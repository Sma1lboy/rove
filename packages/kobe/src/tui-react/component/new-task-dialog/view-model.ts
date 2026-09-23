/**
 * New-task dialog state (JSX in `./dialog.tsx`): shared selectors, the
 * existing tab, key bindings and commit dispatch.
 *
 * Cursor resets live in the input handlers, not an effect on the filtered
 * lists: typing is the only thing that changes them. Submit-time error
 * strings use the module-level `t`.
 */

import { AUTO_ROUTING_TIERS, readAutoRoutingTable } from "@/engine/auto-routing"
import { engineEntry } from "@/engine/registry"
import { type VendorId, nextVendorWithin, prevVendorWithin } from "@/types/vendor"
import type { AdoptableWorktree } from "@/types/worktree"
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
} from "../../../tui/component/new-task-dialog/state"
import { t } from "../../../tui/i18n"
import { DEFAULT_BASE_REF, validateRepoPath } from "../../../tui/lib/git-snapshot"
import { useBindings } from "../../lib/keymap"
import { useTerminalDimensions } from "../../lib/use-terminal-dimensions"
import { useDialog } from "../../ui/dialog"
import { engineAcceptsModel, useModelField } from "../model-field"
import { resolveInitialVendor, resolveVendorSet } from "./pure"
import { useAdoptState } from "./use-adopt-state"
import { useBranchField } from "./use-branch-field"
import { useCloneState } from "./use-clone-state"
import { useRepoField } from "./use-repo-field"

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
}

/** Stable default for `mainRepos` — a per-render `new Set()` defeats memos. */
const EMPTY_MAIN_REPOS: ReadonlySet<string> = new Set()

/** The tier chips: the three depths, then "manual" = pick the fields by hand. */
export const TIER_CHOICES = [...AUTO_ROUTING_TIERS, "manual"] as const
export type TierChoice = (typeof TIER_CHOICES)[number]

export function useNewTaskViewModel(props: NewTaskDialogProps) {
  const dialog = useDialog()

  const [tab, setTab] = useState<DialogTab>("existing")
  const vendors = resolveVendorSet(props.availableVendors)
  const [vendor, setVendor] = useState<VendorId>(() =>
    resolveInitialVendor(resolveVendorSet(props.availableVendors), props.defaultVendor),
  )
  // Open focused on the mode selector — ←/→ switches tabs immediately;
  // Tab then walks engine → [effort] → [model] → repo → branch → Create.
  const [field, setField] = useState<Field>("tabs")
  // Raw pick, READ through the current engine: an undeclared level reads as
  // "engine default" (same rule as change-engine's `seedEffort`).
  const effortLevels = engineEntry(vendor).effortLevels ?? []
  const [effortPick, setEffortPick] = useState("")
  const effort = effortLevels.includes(effortPick) ? effortPick : ""
  const effortChoices = effortLevels.length > 0 ? ["", ...effortLevels] : []
  const modelVisible = engineAcceptsModel(vendor)
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

  /* ── Field clusters (each owns one question the dialog asks) ── */

  // Live per render so a shrunk terminal re-windows the pickers instead of
  // clipping Create. No chrome reserve for effort/model rows: they don't
  // render here, and reserving for them drew over the footer at 120x40.
  const pickerRows = pickerVisibleRows(useTerminalDimensions().height)
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
    // Intent is per-repo; reset so the row doesn't describe the previous path.
    // Safety is `commitExisting`'s own `canOpenProject` guard.
    onChanged: () => setIntent("task"),
    onAnswered: () => setField(advanceField("repo")),
  })
  const expandedRepo = repoField.expandedRepo
  // Offered against the EXPANDED path: `mainRepos` holds absolute repo roots,
  // and a `~/`-typed entry would otherwise never match its own project.
  const canOpenProject = offersProjectIntent(expandedRepo, props.mainRepos ?? EMPTY_MAIN_REPOS)
  const branch = useBranchField({
    expandedRepo,
    pickerRows,
    defaultRepo: props.defaultRepo,
    commit: () => commitExisting(),
    onPicked: () => setField("confirm"),
  })

  const clone = useCloneState({
    defaultCloneParent: props.defaultCloneParent,
    vendor,
    modelEffort: effort || undefined,
    model: modelVisible ? modelField.value.trim() || undefined : undefined,
    tier: tier !== "manual" ? tier : undefined,
    onSubmit: props.onSubmit,
    clearDialog: () => dialog.clear(),
    setField,
    setSubmitError,
  })
  const adopt = useAdoptState({
    active: tab === "adopt",
    expandedRepo,
    vendor,
    discoverAdoptable: props.discoverAdoptable,
    onSubmit: props.onSubmit,
    clearDialog: () => dialog.clear(),
    setSubmitError,
  })

  /* ── Effects ── */

  // biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are the invalidation keys — any edit clears the inline error.
  useEffect(() => {
    setSubmitError(null)
  }, [repoField.repo, clone.cloneUrl, clone.cloneParent, clone.cloneFolder, adopt.adoptFilter])

  /* ── Commit paths ── */

  function commitExisting(): void {
    // Two saved repos can share a basename; reopen the picker (directories
    // visible) rather than opening the alphabetically-first one.
    if (repoField.repoResolution.kind === "ambiguous") {
      setSubmitError(t("newTask.error.repoAmbiguous", { name: repoField.repoResolution.name }))
      setField("repo")
      repoField.reopenPicker()
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
    // "Open the project" resolves to the repo's EXISTING main row, so no
    // baseRef. `canOpenProject` is re-read from the CURRENT repo so `open` is
    // never sent for a path with no main row, even if a caller skips the
    // intent reset in `changeRepo`.
    if (intent === "project" && canOpenProject) {
      props.onSubmit({ mode: "open", repo: r, vendor })
      dialog.clear()
      return
    }
    const b = branch.baseRef.trim() || DEFAULT_BASE_REF
    props.onSubmit({
      repo: r,
      baseRef: b,
      vendor,
      ...(effort ? { modelEffort: effort } : {}),
      ...(modelVisible && modelField.value.trim() ? { model: modelField.value.trim() } : {}),
      ...(tier !== "manual" ? { tier } : {}),
    })
    dialog.clear()
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
   * focus on an invisible input and swallows every keystroke, so depth,
   * model and effort (auto-routing's; a pinned model is a per-task exception;
   * change-engine still shows them) are off. Shared by `advanceField` and
   * `advanceFieldFor` so tests walk the dialog's real cycle.
   */
  function focusStopsFor(forTab: DialogTab) {
    return {
      intentVisible: forTab === "existing" && canOpenProject,
      effortVisible: false,
      modelVisible: false,
      tierVisible: false,
    }
  }

  function advanceField(from: Field): Field {
    const next = nextField(from, tab, focusStopsFor(tab))
    // The "project" intent hides the branch field (`tab-existing.tsx`); skip it.
    if (next === "baseRef" && tab === "existing" && intent === "project" && canOpenProject) {
      return nextField(next, tab)
    }
    return next
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

  /* ── Key bindings (config re-evaluated per keypress — closures fresh) ── */

  useBindings(() => ({
    bindings: [
      {
        key: "tab",
        cmd: () => {
          if (!completeFocusedField()) setField(advanceField)
        },
      },
      // No KobeKeymap row: the dialog labels `MODE  ctrl+[ ]` itself, and F1
      // can't open over a modal.
      { key: "ctrl+]", cmd: () => switchToTab(nextDialogTab(tab)) },
      { key: "ctrl+[", cmd: () => switchToTab(prevDialogTab(tab)) },
      { key: "ctrl+e", cmd: () => cycleEngine(1) },
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "down", cmd: () => moveCursor(1) },
      // ←/→/Enter ONLY while a selector is focused — an always-on binding
      // would preventDefault the keys away from focused text inputs.
      ...(field === "tabs" || field === "tier" || field === "engine" || field === "effort" || field === "intent"
        ? [
            {
              key: "left",
              cmd: () => {
                if (field === "tabs") cycleTab(-1)
                else if (field === "tier") cycleTier(-1)
                else if (field === "engine") cycleEngine(-1)
                else if (field === "effort") stepEffort(-1)
                else setIntent("task")
              },
            },
            {
              key: "right",
              cmd: () => {
                if (field === "tabs") cycleTab(1)
                else if (field === "tier") cycleTier(1)
                else if (field === "engine") cycleEngine(1)
                else if (field === "effort") stepEffort(1)
                else setIntent("project")
              },
            },
            { key: "return", cmd: () => setField(advanceField) },
          ]
        : []),
      // Ctrl+A select-all exists ONLY on the Adopt tab; elsewhere it must
      // fall through to the focused input as line-home.
      ...(tab === "adopt" ? [{ key: "ctrl+a", cmd: adopt.adoptSelectAll }] : []),
    ],
  }))

  // Enter on Create — separate registration with config-level `enabled` so
  // it is OUT of the dispatch stack while another field holds focus.
  useBindings(() => ({
    enabled: field === "confirm" && !clone.cloneInFlight,
    bindings: [{ key: "return", cmd: () => commit() }],
  }))

  return {
    ...clone,
    ...adopt,
    ...branch,
    ...repoField,
    defaultRepo: props.defaultRepo,
    tab,
    vendors,
    vendor,
    setVendor,
    effort,
    effortChoices,
    setEffort: setEffortPick,
    modelVisible,
    modelField,
    /** The tier row renders only while auto routing is configured. */
    tierVisible: tierTable !== null,
    tier,
    pickTier,
    field,
    setField,
    /** Enter inside an input that is not the tab's last stop: walk on. */
    advanceFrom: (from: Field) => setField(advanceField(from)),
    /** The focus walk without moving focus — observes THIS dialog's stops
     *  (shares `focusStopsFor` with `advanceField`). */
    advanceFieldFor: (from: Field, forTab: DialogTab = tab) => nextField(from, forTab, focusStopsFor(forTab)),
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
