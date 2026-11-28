/** @jsxImportSource @opentui/react */
/** File tree header: All / Changes tabs, Changes legend. Pure render. */

import { TextAttributes } from "@opentui/core"
import type { GitScope } from "@sma1lboy/rove-core/worktree/git-status.ts"
import { type FileTreeTab, TAB_ORDER, tabLabelKey } from "../../../tui/panes/filetree/keys-core"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useHoverFill } from "../../ui/use-hover-fill"
import { SidebarSearchInput } from "../sidebar/chrome"
import type { FileSearch } from "./use-file-search"

export type FileTreeHeaderProps = {
  tab: FileTreeTab
  /** Changes-tab scope (working ↔ branch vs base). */
  scope: GitScope
  /** Resolved Branch-scope base ref, or null when none resolved (Branch
   *  scope + `b` toggle are unavailable then). */
  base: string | null
  /** The open `/` query row; it replaces the tab's legend while open. */
  search?: Pick<FileSearch, "query" | "textPending">
  resultCount: number
  onSelectTab: (tab: FileTreeTab) => void
  /** Whole-worktree combined diff, as a chip: its `D` binding is still
   *  PROPOSED (docs/design/keybinding-decisions.md). */
  onDiffAll?: () => void
}

/** One tab: the active one in the accent, the others brighten under the pointer. */
function HeaderTab(props: { label: string; active: boolean; onSelect: () => void }) {
  const { theme } = useTheme()
  const hover = useHoverFill()
  return (
    <box backgroundColor={props.active ? undefined : hover.fill} {...hover.handlers} onMouseUp={props.onSelect}>
      <text
        fg={props.active ? theme.primary : hover.hovered ? theme.text : theme.textMuted}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {props.label}
      </text>
    </box>
  )
}

export function FileTreeHeaderView(props: FileTreeHeaderProps) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <>
      {/* Header: tabs row. Each tab is clickable (sets active), and
         `[` / `]` cycle from the keyboard. */}
      <box flexDirection="row" paddingBottom={0} flexShrink={0} gap={2}>
        {TAB_ORDER.map((tabId) => (
          <HeaderTab
            key={tabId}
            label={t(tabLabelKey(tabId))}
            active={props.tab === tabId}
            onSelect={() => props.onSelectTab(tabId)}
          />
        ))}
      </box>
      {/* Status legend + scope line — only on the Changes tab. The scope
         line names the active view (working tree vs branch-vs-base) and,
         when a base resolved, the `b` toggle affordance. */}
      {props.search ? (
        <box flexDirection="column" paddingTop={1} flexShrink={0}>
          <SidebarSearchInput
            query={props.search.query}
            matchCount={props.resultCount}
            totalCount={props.resultCount}
            placeholder={t("files.search.placeholder")}
            status={props.search.textPending ? t("files.search.searchingText") : String(props.resultCount)}
          />
        </box>
      ) : props.tab === "changes" ? (
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
            // stopPropagation: bubbling would also run the host's focus-the-pane onMouseUp.
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
