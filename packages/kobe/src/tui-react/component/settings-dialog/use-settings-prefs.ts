/**
 * kv-backed preference helpers for the settings dialog —
 * the General/Dev getter+toggle closures, kept apart from `./index.tsx` so the
 * dialog's structure (which sections, which is open) never mixes with the
 * per-preference kv keys and their normalizers. Adding a preference edits only
 * this file. All reads are plain `kv.get` — the
 * KVProvider re-renders the tree on every `kv.set`, so the values are
 * recomputed per render. Sections receive the whole bundle as a single
 * `prefs: SettingsPrefs` prop and call the getters directly.
 */

import { accessSync, constants as fsConstants, mkdirSync } from "node:fs"
import { errorMessage } from "@/lib/error-message"
import { logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import { AUTO_STATUS_KEY } from "../../../state/auto-status"
import { DISPATCHER_KEY } from "../../../state/dispatcher"
import { DEFAULT_SCROLLBACK_ROWS, SCROLLBACK_ROWS_KEY, normalizeScrollbackRows } from "../../../state/scrollback"
import { SPLIT_STYLE_KEY, type SplitStyle, normalizeSplitStyle } from "../../../state/split-style"
import {
  TAB_STRIP_HIDE_SINGLE_KEY,
  TAB_STRIP_MODES,
  TAB_STRIP_MODE_KEY,
  type TabStripMode,
  resolveTabStripMode,
} from "../../../state/tab-strip"
import {
  PROJECT_DIR_TOKEN,
  PROJECT_SIBLING_BASE,
  WORKTREE_BASE_CUSTOM_KEY,
  WORKTREE_BASE_KEY,
  type WorktreeBaseKind,
  hasProjectDirToken,
  normalizeWorktreeBase,
  worktreeBaseKindOf,
} from "../../../state/worktree-base"
import { ZEN_ACTIVE_KEY } from "../../../state/zen"
import {
  DEFAULT_EDITOR_KIND,
  EDITOR_CUSTOM_KEY,
  EDITOR_KINDS,
  EDITOR_KIND_KEY,
  type EditorKind,
  normalizeEditorKind,
} from "../../../tui/lib/editor-prefs"
import {
  PREFIX_TAP_PRESENTATION_KEY,
  type PrefixTapPresentation,
  normalizePrefixTapPresentation,
} from "../../../tui/lib/prefix-tap-presentation"
import type { KVContext } from "../../context/kv"
import { useT } from "../../i18n"
import type { DialogContext } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { RenameTaskDialog } from "../rename-task-dialog"

export function useSettingsPrefs(kv: KVContext, dialog: DialogContext) {
  const t = useT()

  function toastEnabled(): boolean {
    return (kv.get("notifications.toast.enabled", true) as boolean) !== false
  }
  function soundEnabled(): boolean {
    return (kv.get("notifications.sound.enabled", true) as boolean) !== false
  }
  function toggleToast(): void {
    kv.set("notifications.toast.enabled", !toastEnabled())
  }
  function toggleSound(): void {
    kv.set("notifications.sound.enabled", !soundEnabled())
  }
  // Cross-task attention: notify (bell/toast/OSC 9) when a NON-selected task
  // pauses on an approval / errors / finishes a turn. Default on — this is the
  // "call me back when I've switched away" promise that makes parallel useful.
  function crossTaskEnabled(): boolean {
    return (kv.get("notifications.crossTask.enabled", true) as boolean) !== false
  }
  function toggleCrossTask(): void {
    kv.set("notifications.crossTask.enabled", !crossTaskEnabled())
  }

  function prefixTapPresentation(): PrefixTapPresentation {
    return normalizePrefixTapPresentation(kv.get(PREFIX_TAP_PRESENTATION_KEY))
  }
  function selectPrefixTapPresentation(next: PrefixTapPresentation): void {
    kv.set(PREFIX_TAP_PRESENTATION_KEY, next)
  }
  // Appearance: how split leaves draw — full box frames or single dividers.
  function splitStyle(): SplitStyle {
    return normalizeSplitStyle(kv.get(SPLIT_STYLE_KEY))
  }
  function selectSplitStyle(style: SplitStyle): void {
    kv.set(SPLIT_STYLE_KEY, style)
  }

  // Zen mode: whether the workspace starts collapsed to the engine pane.
  // Same key the runtime toggle writes (`state/zen.ts`), so this row is both
  // the startup default and a mirror of the current session's zen state.
  function zenDefaultOn(): boolean {
    return kv.get(ZEN_ACTIVE_KEY, false) === true
  }
  function toggleZenDefaultOn(): void {
    kv.set(ZEN_ACTIVE_KEY, !zenDefaultOn())
  }

  // Chat tab strip: never / only with 2+ tabs / always. Cycles rather than
  // toggles — "off" is the default now that the sidebar tree lists tabs, so
  // the setting has three states rather than a boolean (state/tab-strip.ts).
  function tabStripMode(): TabStripMode {
    return resolveTabStripMode(kv.get(TAB_STRIP_MODE_KEY, undefined), kv.get(TAB_STRIP_HIDE_SINGLE_KEY, undefined))
  }
  function cycleTabStripMode(): void {
    const next = TAB_STRIP_MODES[(TAB_STRIP_MODES.indexOf(tabStripMode()) + 1) % TAB_STRIP_MODES.length]
    kv.set(TAB_STRIP_MODE_KEY, next)
  }

  // Experimental flags (Dev section).
  function remoteProjectsEnabled(): boolean {
    return kv.get("experimental.remoteProjects", false) === true
  }
  function toggleRemoteProjects(): void {
    kv.set("experimental.remoteProjects", !remoteProjectsEnabled())
  }
  function autoStatusOn(): boolean {
    return kv.get(AUTO_STATUS_KEY, false) === true
  }
  function toggleAutoStatus(): void {
    kv.set(AUTO_STATUS_KEY, !autoStatusOn())
  }
  function dispatcherOn(): boolean {
    return kv.get(DISPATCHER_KEY, false) === true
  }
  function toggleDispatcher(): void {
    kv.set(DISPATCHER_KEY, !dispatcherOn())
  }
  // Editor preference: which editor the file tree's `e` key launches.
  function editorKind(): EditorKind {
    return normalizeEditorKind(kv.get(EDITOR_KIND_KEY, DEFAULT_EDITOR_KIND))
  }
  function cycleEditorKind(): void {
    const i = EDITOR_KINDS.indexOf(editorKind())
    const next = EDITOR_KINDS[(i + 1) % EDITOR_KINDS.length]
    if (next) kv.set(EDITOR_KIND_KEY, next)
  }
  function editorCustomCommand(): string {
    const v = kv.get(EDITOR_CUSTOM_KEY, "")
    return typeof v === "string" ? v : ""
  }
  async function editEditorCustom(): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, editorCustomCommand(), {
      // No params on purpose: the `{file}` in this title is a command
      // placeholder the user types, not an i18n slot. `interpolate` leaves
      // the template untouched when no params are passed.
      dialogTitle: t("settings.general.editorCustomTitle"),
      fieldLabel: t("settings.field.command"),
      submitLabel: t("settings.action.save"),
      allowEmpty: true,
    })
    if (next === undefined) return
    const cmd = next.trim()
    kv.set(EDITOR_CUSTOM_KEY, cmd)
    // A command typed here should take effect — flip the kind to `custom`.
    if (cmd) kv.set(EDITOR_KIND_KEY, "custom")
  }

  // Terminal scrollback: rows of history each embedded terminal keeps.
  // Applies to terminals spawned after the change (PTYs resolve it at
  // construction — see state/scrollback.ts).
  function scrollbackRows(): number {
    return normalizeScrollbackRows(kv.get(SCROLLBACK_ROWS_KEY, DEFAULT_SCROLLBACK_ROWS))
  }
  async function editScrollbackRows(): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, String(scrollbackRows()), {
      dialogTitle: t("settings.general.scrollbackTitle"),
      fieldLabel: t("settings.general.scrollbackField"),
      submitLabel: t("settings.action.save"),
      placeholder: String(DEFAULT_SCROLLBACK_ROWS),
    })
    if (next === undefined) return
    const n = Number.parseInt(next.trim(), 10)
    if (!Number.isFinite(n)) {
      await DialogConfirm.show(
        dialog,
        t("settings.general.scrollbackInvalidTitle"),
        t("settings.general.scrollbackInvalidBody"),
        "cancel",
      )
      return
    }
    kv.set(SCROLLBACK_ROWS_KEY, normalizeScrollbackRows(n))
  }

  // Worktree location: a global override for where new LOCAL task worktrees
  // are created — preset cycle (default → next-to-project → custom) + validation.
  function worktreeBasePath(): string {
    const v = kv.get(WORKTREE_BASE_KEY, "")
    return typeof v === "string" ? v : ""
  }
  const worktreeKind = (): WorktreeBaseKind => worktreeBaseKindOf(worktreeBasePath())
  function worktreeKindLabel(): string {
    const kind = worktreeKind()
    if (kind === "default") return t("settings.general.worktreeKindDefault")
    if (kind === "nextToProject") return t("settings.general.worktreeKindNext")
    return t("settings.general.worktreeKindCustom")
  }
  function worktreeCustomPath(): string {
    const v = kv.get(WORKTREE_BASE_CUSTOM_KEY, "")
    const remembered = typeof v === "string" ? v.trim() : ""
    // A custom path saved before the preset cycle existed lives only in
    // the base key — surface it so the row isn't misleadingly "(unset)".
    return remembered || (worktreeKind() === "custom" ? worktreeBasePath().trim() : "")
  }
  function cycleWorktreeBase(): void {
    const kind = worktreeKind()
    if (kind === "default") {
      kv.set(WORKTREE_BASE_KEY, PROJECT_SIBLING_BASE)
    } else if (kind === "nextToProject") {
      // No remembered custom path → nothing to cycle onto; back to default.
      kv.set(WORKTREE_BASE_KEY, worktreeCustomPath())
    } else {
      kv.set(WORKTREE_BASE_CUSTOM_KEY, worktreeBasePath().trim())
      kv.set(WORKTREE_BASE_KEY, "")
    }
  }
  async function editWorktreeCustom(): Promise<void> {
    const next = await RenameTaskDialog.show(dialog, worktreeCustomPath(), {
      dialogTitle: t("settings.general.worktreeBaseTitle"),
      fieldLabel: t("settings.general.worktreeBaseField"),
      submitLabel: t("settings.action.save"),
      placeholder: `${PROJECT_DIR_TOKEN}/../worktrees`,
      allowEmpty: true,
    })
    if (next === undefined) return
    const raw = next.trim()
    // Validate (create + writability check) and refuse to save a bad path.
    if (raw.includes(PROJECT_DIR_TOKEN)) {
      if (!hasProjectDirToken(raw)) {
        await DialogConfirm.show(
          dialog,
          t("settings.general.worktreeBaseInvalidTitle"),
          t("settings.general.worktreeBaseTokenBody", { token: PROJECT_DIR_TOKEN }),
          "cancel",
        )
        return
      }
    } else if (raw) {
      const resolved = normalizeWorktreeBase(raw) ?? raw
      try {
        mkdirSync(resolved, { recursive: true })
        accessSync(resolved, fsConstants.W_OK)
      } catch (err) {
        await DialogConfirm.show(
          dialog,
          t("settings.general.worktreeBaseInvalidTitle"),
          t("settings.general.worktreeBaseUnusableBody", { path: resolved, error: errorMessage(err) }),
          "cancel",
        )
        return
      }
    }
    kv.set(WORKTREE_BASE_CUSTOM_KEY, raw)
    if (raw) kv.set(WORKTREE_BASE_KEY, raw)
    else if (worktreeKind() === "custom") kv.set(WORKTREE_BASE_KEY, "")
  }

  return {
    toastEnabled,
    toggleToast,
    soundEnabled,
    toggleSound,
    crossTaskEnabled,
    toggleCrossTask,
    prefixTapPresentation,
    selectPrefixTapPresentation,
    splitStyle,
    selectSplitStyle,
    zenDefaultOn,
    toggleZenDefaultOn,
    remoteProjectsEnabled,
    toggleRemoteProjects,
    autoStatusOn,
    toggleAutoStatus,
    dispatcherOn,
    toggleDispatcher,
    editorKind,
    cycleEditorKind,
    editorCustomCommand,
    editEditorCustom,
    scrollbackRows,
    editScrollbackRows,
    tabStripMode,
    cycleTabStripMode,
    worktreeKind,
    worktreeKindLabel,
    worktreeCustomPath,
    cycleWorktreeBase,
    editWorktreeCustom,
  }
}

/** The prefs bundle sections receive as a single `prefs` prop. */
export type SettingsPrefs = ReturnType<typeof useSettingsPrefs>
