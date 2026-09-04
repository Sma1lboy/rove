/**
 * View-model hook for the new-task dialog — the dialog's state, with the JSX
 * in `./dialog.tsx`. Every pure helper (field cycling, filters, windowing)
 * comes from the SHARED `src/tui/component/new-task-dialog/state.ts` /
 * `clone.ts` / `src/tui/lib/git-snapshot.ts` / `path-helpers.ts` modules.
 * The clone and adopt clusters live in `./use-clone-state.ts` /
 * `./use-adopt-state.ts`; this hook owns the shared selectors, the existing
 * tab, the key bindings, and the commit dispatch.
 *
 * Cursor resets live inside the input handlers rather than in an effect on
 * the filtered lists: typing is the only thing that changes those lists.
 * Error strings resolved at submit time use the module-level `t`.
 */

import { type VendorId, nextVendorWithin, prevVendorWithin } from "@/types/vendor"
import type { AdoptableWorktree } from "@/types/worktree"
import { useTerminalDimensions } from "@opentui/react"
import { useEffect, useState } from "react"
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
import { useDialog } from "../../ui/dialog"
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

/** Shared default for `mainRepos` — a fresh `new Set()` per render would be a
 *  new identity every time and defeat any memo keyed on it. */
const EMPTY_MAIN_REPOS: ReadonlySet<string> = new Set()

export function useNewTaskViewModel(props: NewTaskDialogProps) {
  const dialog = useDialog()

  const [tab, setTab] = useState<DialogTab>("existing")
  const vendors = resolveVendorSet(props.availableVendors)
  const [vendor, setVendor] = useState<VendorId>(() =>
    resolveInitialVendor(resolveVendorSet(props.availableVendors), props.defaultVendor),
  )
  // Open focused on the mode selector — ←/→ switches tabs immediately;
  // Tab then walks engine → repo → branch → Create.
  const [field, setField] = useState<Field>("tabs")
  // Existing-tab intent. Defaults to "task"; the choice only RENDERS when the
  // picked repo already has a project checkout to open.
  const [intent, setIntent] = useState<ExistingIntent>("task")

  // Validation error shown inline on submit; cleared on any input edit.
  const [submitError, setSubmitError] = useState<string | null>(null)

  /* ── Field clusters (each owns one question the dialog asks) ── */

  // Live per render — opentui re-renders on resize, so a terminal dragged
  // short re-windows the pickers instead of clipping the Create button.
  const pickerRows = pickerVisibleRows(useTerminalDimensions().height)
  const repoField = useRepoField({
    defaultRepo: props.defaultRepo,
    savedRepos: props.savedRepos,
    pickerRows,
    // A different repo may have no project checkout at all, and the choice is
    // per-repo, so carrying "project" across a change leaves the row
    // asserting something about the previous path. `commitExisting` is
    // separately guarded on `canOpenProject`, so this is about the row
    // telling the truth, not about safety.
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
    // Two saved repos can share a basename (a hundred flat repos under one
    // parent makes this ordinary), and the name alone cannot say which. Send
    // the user back to the picker — where the directories that separate them
    // are on screen — rather than opening the alphabetically-first one.
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
    // "Open the project" is a different verb, not a create with a flag: it
    // resolves to the repo's EXISTING main row, so it carries no baseRef —
    // there is no branch to fork from when you are opening the checkout
    // itself.
    //
    // `canOpenProject` is re-read here rather than trusted from when the
    // choice was made: it derives from the CURRENT repo, so this cannot
    // submit `open` for a path that has no main row to resolve. `changeRepo`
    // already resets the intent on every repo change, which makes the two
    // agree in practice — this is the half that does not depend on every
    // future caller remembering to go through it.
    if (intent === "project" && canOpenProject) {
      props.onSubmit({ mode: "open", repo: r, vendor })
      dialog.clear()
      return
    }
    const b = branch.baseRef.trim() || DEFAULT_BASE_REF
    props.onSubmit({ repo: r, baseRef: b, vendor })
    dialog.clear()
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
   * Tab/Enter's next stop, honouring the intent. Opening a project hides the
   * branch field (`tab-existing.tsx`), and the pure `nextField` chain knows
   * nothing about that — walking into a field that isn't rendered would park
   * focus on an invisible input and swallow every keystroke.
   */
  function advanceField(from: Field): Field {
    const next = nextField(from, tab, { intentVisible: tab === "existing" && canOpenProject })
    // The branch field is gone under the "project" intent, so skip its stop
    // too — same reason, one field further along.
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

  /**
   * Tab, wherever it lands on a field that has a suggestion open: complete
   * first, advance only when there is nothing to complete. Both path fields
   * in this dialog answer to it — the Existing tab's repo and the Clone tab's
   * parent dir are the same drill-down picker, and a key that walked one but
   * not the other would be worse than a key that walked neither.
   */
  function completeFocusedField(): boolean {
    if (tab === "existing" && field === "repo") return repoField.completeRepo()
    if (tab === "clone" && field === "cloneParent") return clone.completeCloneParent()
    return false
  }

  // up/down over whichever picker the focused field drives.
  function moveCursor(delta: 1 | -1): void {
    if (clone.cloneInFlight) return
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
      { key: "ctrl+]", cmd: () => switchToTab(nextDialogTab(tab)) },
      { key: "ctrl+[", cmd: () => switchToTab(prevDialogTab(tab)) },
      { key: "ctrl+e", cmd: () => cycleEngine(1) },
      { key: "up", cmd: () => moveCursor(-1) },
      { key: "down", cmd: () => moveCursor(1) },
      // ←/→/Enter ONLY while a selector is focused — an always-on binding
      // would preventDefault the keys away from focused text inputs.
      ...(field === "tabs" || field === "engine" || field === "intent"
        ? [
            {
              key: "left",
              cmd: () => {
                if (field === "tabs") cycleTab(-1)
                else if (field === "engine") cycleEngine(-1)
                else setIntent("task")
              },
            },
            {
              key: "right",
              cmd: () => {
                if (field === "tabs") cycleTab(1)
                else if (field === "engine") cycleEngine(1)
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
    field,
    setField,
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
