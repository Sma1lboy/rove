/** @jsxImportSource @opentui/react */
/** File tree header: Zen / Create-PR chips, All / Changes tabs, Changes legend. Pure render. */

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
  tab: FileTreeTab
  /** Changes-tab scope (working ↔ branch vs base). */
  scope: GitScope
  /** Resolved Branch-scope base ref, or null when none resolved (Branch
   *  scope + `b` toggle are unavailable then). */
  base: string | null
  onSelectTab: (tab: FileTreeTab) => void
  /** Optional Ops-pane chips (see FileTreeProps). */
  onZenToggle?: () => void
  onCreatePR?: () => void
  /** Whole-worktree combined diff, as a chip: its `D` binding is still
   *  PROPOSED (docs/design/keybinding-decisions.md). */
  onDiffAll?: () => void
}

export function FileTreeHeaderView(props: FileTreeHeaderProps) {
  const { theme } = useTheme()
  const t = useT()
  // Live prefix key so the cap follows a remap; null (prefix disabled) → no cap.
  const prefixKey = currentPrefixConfiguration().key
  const createPRChord = prefixKey ? `[${formatChord(prefixKey)} P]` : null
  // Zen is prefix-only too; its cap comes from the live binding, never a literal.
  const zenStroke = findBinding("workspace.zenToggle")?.prefixKeys?.[0]
  const zenChord = prefixKey && zenStroke ? `[${formatChord(prefixKey)} ${zenStroke.toUpperCase()}]` : null
  return (
    <>
      {/* Action row — sits above the All / Changes tabs so it's reachable
         from both tabs. Zen toggle sits left of Create PR (prefix+p). */}
      {props.onZenToggle || props.onCreatePR ? (
        // wrap + chips flexShrink={0}: a narrow pane stacks whole chips
        // instead of squeezing their inner gaps or overflowing the border.
        // columnGap, NOT gap: `gap` also sets the vertical gutter, and the
        // chips always wrap (8 + 2 + 30 cells vs the pane's 22-34 clamp).
        <box
          flexDirection="row"
          flexWrap="wrap"
          justifyContent="flex-end"
          columnGap={2}
          paddingBottom={1}
          flexShrink={0}
        >
          {props.onZenToggle ? (
            // stopPropagation: bubbling to the host's focus-the-pane onMouseUp
            // would toggle zen on and exit it via the focus-leaves-workspace guard.
            <box
              position="relative"
              flexDirection="row"
              gap={1}
              // Never squeeze: shrink eats the keycap/label gap first.
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
            // stopPropagation: same reason as the Zen chip.
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
