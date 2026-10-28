/** @jsxImportSource @opentui/react */
/**
 * React half of `src/tui/lib/keyboard-hints.ts`:
 *
 *   - `StatusKeyHintBar` / `useStatusKeyHintItems`: the status-bar micro-hint
 *     (`⌃ A commands · F1 help · [settings]`). Every segment is clickable —
 *     clicks don't pass through to the PTY, so they work inside the terminal.
 *   - `PaneKeyHint`: one muted line per vim-style pane; the first-use variant
 *     goes away for good once the pane's keys are used (`usePaneHintMark`).
 *
 * No backgroundColor of their own, so they read over transparent themes too
 * (pinned by test/tui-react/keyboard-overlay-theme.test). Chords resolve
 * through the live keymap; `useKeymapVersion()` tracks YAML rebinds.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { formatChord } from "../../tui/lib/chord-glyphs"
import {
  type HintPane,
  KEY_HINTS_ENABLED_KEY,
  PANE_HINT_USED_KEYS,
  type StatusHintToken,
  keyHintsEnabled,
  paneHintTokens,
  paneHintVisible,
  statusHintTokens,
} from "../../tui/lib/keyboard-hints"
import { currentPrefixConfiguration } from "../../tui/lib/keymap-dispatch"
import { useOptionalFocus } from "../context/focus"
import { useKeymapVersion } from "../context/keybindings"
import { useOptionalKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import {
  armPrefixFromCurrentStack,
  currentBindingReachability,
  modalActive,
  subscribeBindingStack,
} from "../lib/keymap"
import { useOptionalDialog } from "../ui/dialog"
import { HelpDialog } from "./help-dialog"
import { ShortcutRevealBadge } from "./shortcut-reveal"

type HintSnapshot = { readonly tokens: readonly StatusHintToken[]; readonly modal: boolean }
const EMPTY_HINT_SNAPSHOT: HintSnapshot = { tokens: [], modal: false }

export type StatusKeyHintItem = {
  text: string
  bindingId?: string
  /** Mouse activation — the same action the advertised key would run. */
  onPress?: () => void
}

/**
 * Status-bar hint segments from the live binding stack; empty when nothing
 * truthful is left (hints off, prefix disabled AND help unbound, …).
 */
export function useStatusKeyHintItems(opts?: { onOpenSettings?: () => void; compact?: boolean }): StatusKeyHintItem[] {
  const t = useT()
  const kv = useOptionalKV()
  // Reachability depends on focus, keymap and registrations (made in mount
  // effects, AFTER first render) — subscribe to all three.
  const focus = useOptionalFocus()
  const dialog = useOptionalDialog()
  const keymapVersion = useKeymapVersion()
  // Read as a plain boolean: `kv` itself must not be an effect dependency
  // (see the note below).
  const hintsEnabled = keyHintsEnabled(kv?.get(KEY_HINTS_ENABLED_KEY, true))
  const [snapshot, setSnapshot] = useState<HintSnapshot>(EMPTY_HINT_SNAPSHOT)
  const shownRef = useRef(snapshot)
  const enabledRef = useRef(hintsEnabled)
  const dialogDepthRef = useRef(dialog?.stack.length ?? 0)
  enabledRef.current = hintsEnabled
  dialogDepthRef.current = dialog?.stack.length ?? 0
  // Snapshot AFTER commit, never during render: `enabled` gates read refs
  // refreshed in CHILD renders, and this hook lives in a parent (the footer),
  // so a render-time read sees the previous cycle. Effects run children-first.
  // setState only on a real change: the footer wraps the pane tree, so even a
  // no-op update costs a root commit, and a looping one is React #185.
  const refresh = useCallback(() => {
    const enabled = enabledRef.current
    // Modal = barrier OR non-empty dialog stack. The stack fills a render
    // EARLIER; checking only the barrier leaves one frame with empty
    // reachability and no modal, and the footer blanks out for good.
    const nextModal = modalActive() || dialogDepthRef.current > 0
    const fresh =
      enabled && !nextModal ? statusHintTokens(currentBindingReachability(), currentPrefixConfiguration().key) : null
    const prev = shownRef.current
    // Under a modal the reachability walk is empty, so freeze the last
    // non-modal tokens; the segments go inert below.
    const nextTokens = fresh ?? (enabled ? prev.tokens : [])
    if (
      prev.modal === nextModal &&
      prev.tokens.length === nextTokens.length &&
      prev.tokens.every((tok, i) => tok.chord === nextTokens[i]?.chord && tok.msg === nextTokens[i]?.msg)
    )
      return
    const next = { tokens: nextTokens, modal: nextModal }
    shownRef.current = next
    setSnapshot(next)
  }, [])
  // Registrations land in mount/unmount effects, a dozen per task switch.
  // Re-read once after the effect flush instead of re-rendering per bump.
  useEffect(() => {
    let queued = false
    let live = true
    const unsubscribe = subscribeBindingStack(() => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (live) refresh()
      })
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [refresh])
  // The keymap version covers rebinds; focus + dialog stack cover the rest of
  // what reachability reads. NOT `kv`: KVProvider rebuilds its value on every
  // `kv.set` anywhere. Depend on the boolean instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the deps are INVALIDATION KEYS for live module state `refresh` reads.
  useEffect(refresh, [keymapVersion, focus?.focused, dialog?.stack.length, hintsEnabled])
  // Click = the advertised key's action; arming goes through the REAL
  // dispatcher, so the which-key guide accepts a keyboard second stroke.
  // Inert under a modal: no prefix / second dialog under the open one.
  const actions: Record<StatusHintToken["msg"], (() => void) | undefined> = snapshot.modal
    ? { commands: undefined, sidebar: undefined, help: undefined }
    : {
        commands: () => void armPrefixFromCurrentStack(),
        sidebar: focus ? () => focus.setFocused("sidebar") : undefined,
        help: dialog ? () => HelpDialog.show(dialog, focus?.focused ?? "sidebar") : undefined,
      }
  // Compact: chord caps only (`⌃ A · F1`), no [settings] segment.
  const items: StatusKeyHintItem[] = snapshot.tokens.map((tok) => ({
    text: opts?.compact ? formatChord(tok.chord) : t(`hints.status.${tok.msg}`, { key: formatChord(tok.chord) }),
    onPress: actions[tok.msg],
  }))
  // No glyph: U+2699 ⚙ is East-Asian-Ambiguous width and misaligns per
  // OS/font. Inert under a modal — Settings must not open under a dialog.
  if (opts?.onOpenSettings && !opts.compact && hintsEnabled) {
    items.push({
      text: `[${t("hints.status.settings")}]`,
      bindingId: "settings.open",
      onPress: snapshot.modal ? undefined : opts.onOpenSettings,
    })
  }
  return items
}

/** The footer's hint row: muted key captions, each mouse-activatable. */
export function StatusKeyHintBar(props: { onOpenSettings?: () => void; compact?: boolean }) {
  const { theme } = useTheme()
  const items = useStatusKeyHintItems({ onOpenSettings: props.onOpenSettings, compact: props.compact })
  if (items.length === 0) return null
  return (
    <box flexDirection="row" flexShrink={0}>
      {items.flatMap((item, index) => [
        index > 0 ? (
          <text key={`sep-${item.text}`} fg={theme.textMuted} wrapMode="none">
            {" · "}
          </text>
        ) : null,
        <box key={item.text} position="relative" onMouseUp={item.onPress}>
          <text fg={theme.textMuted} wrapMode="none">
            {item.text}
          </text>
          {item.bindingId ? <ShortcutRevealBadge bindingId={item.bindingId} cover /> : null}
        </box>,
      ])}
    </box>
  )
}

/** Retire a pane's first-use hint; call from its key handlers. Writes once,
 *  safe per keypress. */
export function usePaneHintMark(pane: HintPane): () => void {
  const kv = useOptionalKV()
  return useCallback(() => {
    if (!kv) return
    if (kv.get(PANE_HINT_USED_KEYS[pane], false) !== true) kv.set(PANE_HINT_USED_KEYS[pane], true)
  }, [kv, pane])
}

/**
 * A pane's hint line: the fuller first-use variant until the pane's keys
 * have been used, then the pane's permanent short set (empty for the
 * sidebar — it renders nothing after first use). Null when hints are off
 * or every advertised binding is unbound.
 */
export function PaneKeyHint(props: { pane: HintPane }) {
  const t = useT()
  const { theme } = useTheme()
  const kv = useOptionalKV()
  useKeymapVersion()
  const enabledRaw = kv?.get(KEY_HINTS_ENABLED_KEY, true)
  const usedRaw = kv?.get(PANE_HINT_USED_KEYS[props.pane], false)
  if (!keyHintsEnabled(enabledRaw)) return null
  const tokens = paneHintTokens(props.pane, paneHintVisible(enabledRaw, usedRaw) ? "firstUse" : "always")
  if (tokens.length === 0) return null
  return (
    <text fg={theme.textMuted} wrapMode="none">
      {tokens.map((tok) => `${formatChord(tok.cap)} ${t(`hints.pane.${tok.msg}`)}`).join(" · ")}
    </text>
  )
}
