/** @jsxImportSource @opentui/react */
/**
 * View for the file tree pane's header chrome: the optional
 * Zen / Create-PR action row, the All / Changes tab chips, and the
 * Changes-tab status legend. Pure render — tab state and actions stay in
 * the pane component.
 */

import { TextAttributes } from "@opentui/core"
import { findBinding } from "../../../tui/context/keybindings"
import { formatChord } from "../../../tui/lib/chord-glyphs"
import { currentPrefixConfiguration } from "../../../tui/lib/keymap-dispatch"
import type { GitScope } from "../../../tui/panes/filetree/git"
import { type FileTreeTab, TAB_ORDER, tabLabelKey } from "../../../tui/panes/filetree/keys-core"
import { ShortcutRevealBadge } from "../../component/shortcut-reveal"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"

export type FileTreeHeaderProps = {
  /** The active tab. */
  tab: FileTreeTab
  /** Changes-tab scope (working ↔ branch vs base). */
  scope: GitScope
  /** Resolved Branch-scope base ref, or null when none resolved (Branch
   *  scope + `b` toggle are unavailable then). */
  base: string | null
  /** Mouse tab switch. */
  onSelectTab: (tab: FileTreeTab) => void
  /** Optional Ops-pane chips (see FileTreeProps). */
  onZenToggle?: () => void
  onCreatePR?: () => void
  /** Open the whole worktree's combined diff in one tab. Rendered as a chip on
   *  the Changes tab so the feature is reachable with no chord at all — its
   *  `D` binding is still PROPOSED (docs/design/keybinding-decisions.md). */
  onDiffAll?: () => void
}

export function FileTreeHeaderView(props: FileTreeHeaderProps) {
  const { theme } = useTheme()
  const t = useT()
  // Create PR is a global prefix chord (prefix+p) — render the live prefix
  // key so the hint follows a user-remapped prefix. Null when the prefix is
  // disabled: the chip stays clickable, just without a chord label.
  const prefixKey = currentPrefixConfiguration().key
  const createPRChord = prefixKey ? `[${formatChord(prefixKey)} P]` : null
  // Zen is prefix-only too, so its cap comes from the same live pair. It used
  // to be the string literal `[~]`, and `~` is bound to nothing anywhere in
  // Rove — the chip taught a dead key while `prefix+z` was the real one.
  const zenStroke = findBinding("workspace.zenToggle")?.prefixKeys?.[0]
  const zenChord = prefixKey && zenStroke ? `[${formatChord(prefixKey)} ${zenStroke.toUpperCase()}]` : null
  return (
    <>
      {/* Action row — sits above the All / Changes tabs so it's reachable
         from both tabs. Zen toggle sits left of Create PR (prefix+p). */}
      {props.onZenToggle || props.onCreatePR ? (
        // wrap, and chips flexShrink={0}: on a narrow pane Yoga squeezes the
        // chips' inner gaps first ("[~]Zen"), and with shrink forbidden the
        // row would overflow the pane border instead — wrapping stacks the
        // chips right-aligned, both still whole.
        //
        // columnGap, NOT gap: Yoga's `gap` sets BOTH gutters, so the wrap this
        // row is designed around also inherited a 2-row vertical gutter — and
        // the chips ALWAYS wrap (8 + 2 + 30 cells against the pane's 22-34
        // cell clamp), so the header permanently opened with Zen, two blank
        // rows, Create PR. Only the horizontal gutter is wanted here.
        <box
          flexDirection="row"
          flexWrap="wrap"
          justifyContent="flex-end"
          columnGap={2}
          paddingBottom={1}
          flexShrink={0}
        >
          {props.onZenToggle ? (
            // stopPropagation: the chip click must NOT bubble to the host
            // pane box's own onMouseUp (workspace host focuses the files
            // pane there) — zen would toggle on and instantly exit via
            // the focus-leaves-workspace guard. A chip click is an
            // action, never a background pane click.
            <box
              position="relative"
              flexDirection="row"
              gap={1}
              // Never squeeze the chip below its content: on a narrow pane the
              // shrink ate the inner gap first ("[~]Zen"), which reads as one
              // garbled token instead of a keycap + label.
              flexShrink={0}
              onMouseUp={(e: { stopPropagation(): void }) => {
                e.stopPropagation()
                props.onZenToggle?.()
              }}
            >
              {zenChord ? (
                <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
                  {zenChord}
                </text>
              ) : null}
              <text fg={theme.text} wrapMode="none">
                {t("files.actions.zen")}
              </text>
              <ShortcutRevealBadge bindingId="workspace.zenToggle" />
            </box>
          ) : null}
          {props.onCreatePR ? (
            <box
              flexDirection="row"
              gap={1}
              // Same no-squeeze rule as the Zen chip.
              flexShrink={0}
              onMouseUp={(e: { stopPropagation(): void }) => {
                e.stopPropagation()
                props.onCreatePR?.()
              }}
            >
              {createPRChord ? (
                <box position="relative">
                  <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
                    {createPRChord}
                  </text>
                  <ShortcutRevealBadge bindingId="files.createPR" cover />
                </box>
              ) : null}
              <text fg={theme.text} wrapMode="none">
                {t("files.actions.createPR")}
              </text>
            </box>
          ) : null}
        </box>
      ) : null}
      {/* Header: tabs row. Each tab is clickable (sets active), and
         `[` / `]` cycle from the keyboard. */}
      <box flexDirection="row" paddingBottom={0} flexShrink={0} gap={2}>
        {TAB_ORDER.map((tabId) => {
          const isActive = props.tab === tabId
          return (
            <text
              key={tabId}
              fg={isActive ? theme.primary : theme.textMuted}
              attributes={isActive ? TextAttributes.BOLD : undefined}
              wrapMode="none"
              onMouseUp={() => props.onSelectTab(tabId)}
            >
              {t(tabLabelKey(tabId))}
            </text>
          )
        })}
      </box>
      {/* Status legend + scope line — only on the Changes tab. The scope
         line names the active view (working tree vs branch-vs-base) and,
         when a base resolved, the `b` toggle affordance. */}
      {props.tab === "changes" ? (
        <box flexDirection="column" paddingBottom={1} flexShrink={0} gap={0}>
          {/* Wraps: the no-base reason does not fit a narrow pane on one
             line, and a truncated reason is no better than no reason. */}
          <text fg={theme.textMuted} wrapMode="word">
            {props.scope === "branch" && props.base != null
              ? t("files.scope.branch", { base: props.base })
              : t("files.scope.working")}
            {/* No base means Branch scope cannot be entered at all, so `b` is
               a no-op. Saying why beats a bare scope line next to a sidebar
               row reporting commits the pane cannot show. */}
            {props.base != null ? `  ${t("files.scope.toggleHint")}` : `  ${t("files.scope.noBase")}`}
          </text>
          <text fg={theme.textMuted} wrapMode="none">
            {t("files.legend.changes")}
          </text>
          {props.onDiffAll ? (
            // stopPropagation for the same reason the Zen chip does it: a chip
            // click is an action, never a background click on the pane.
            <text
              fg={theme.accent}
              wrapMode="none"
              onMouseUp={(e: { stopPropagation(): void }) => {
                e.stopPropagation()
                props.onDiffAll?.()
              }}
            >
              {t("files.actions.diffAll")}
            </text>
          ) : null}
        </box>
      ) : (
        <box flexDirection="row" paddingBottom={1} flexShrink={0} />
      )}
    </>
  )
}
