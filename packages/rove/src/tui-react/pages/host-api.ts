/**
 * The page host API: everything a plugin page may use from Rove, handed to its
 * factory (`export default (host) => Page`). A page imports `react`,
 * `@opentui/react` and `@opentui/core` itself (the host's own instances, see
 * `load-plugin-pages.ts`); the rest reaches it only through this object, so
 * the host's internals can move without breaking a page.
 *
 * Experimental: `apiVersion` bumps on any incompatible change.
 */

import { EVENT_FEED_LIMIT, eventRows } from "@sma1lboy/rove-client/lib/issue-events-core.ts"
import { sidebarProjectLabel } from "@sma1lboy/rove-client/sidebar/groups.ts"
import { availableEngineIds } from "@sma1lboy/rove-core/engine/account-detect.ts"
import { engineDisplayName } from "@sma1lboy/rove-core/engine/interactive-command.ts"
import { registerMessages, t } from "@sma1lboy/rove-core/i18n/index.ts"
import { asAttachmentPaths, captureClipboardAttachment } from "@sma1lboy/rove-core/lib/attachments.ts"
import { errorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { isNarrowWidth } from "@sma1lboy/rove-core/lib/narrow-mode.ts"
import { relativeAge } from "@sma1lboy/rove-core/lib/relative-time.ts"
import { truncateEnd } from "@sma1lboy/rove-core/lib/truncate.ts"
import { applyBoardAttention, buildIssueBoard, moveBoardSelection } from "@sma1lboy/rove-core/state/issue-board.ts"
import { ISSUE_CHAT_PLACEMENTS, withImagePlaceholders } from "@sma1lboy/rove-core/state/issue-chat.ts"
import { isRemoteRepoKey } from "@sma1lboy/rove-core/state/remote-repos.ts"
import { getSavedRepos } from "@sma1lboy/rove-core/state/repos.ts"
import { ISSUE_STATUSES } from "@sma1lboy/rove-daemon/daemon/issues-store"
import { pathIdentity, samePath } from "@sma1lboy/rove-daemon/path-identity"
import { clampCursor, stripNewlines } from "../../tui/component/new-task-dialog/state"
import { taskGroupIn, taskGroupLabel, taskGroupTone } from "../../tui/panes/sidebar/task-group-view"
import { FailureHint } from "../component/failure-hint"
import { useNotifications } from "../context/notifications"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { pageCloseBindings, useBindings } from "../lib/keymap"
import { useCursorFollow } from "../lib/use-cursor-follow"
import { useGlobalMouseDown } from "../lib/use-global-mouse-down"
import { useTerminalSize } from "../lib/use-terminal-size"
import { ContextMenu } from "../ui/context-menu"
import { showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import {
  ChipButton,
  ChipRow,
  DialogField,
  DialogFooter,
  DialogHeader,
  DialogLabel,
  DialogSection,
} from "../ui/dialog-parts"
import { FRAME } from "../ui/frame"
import { resolveRowSelectionChrome } from "../ui/row-selection-chrome"
import { quickForkDefaultVendor } from "../workspace/quick-fork"
import { usePageServices } from "./services"

export const PAGE_HOST_API_VERSION = 1

export const pageHost = {
  apiVersion: PAGE_HOST_API_VERSION,
  /** `t` reads the current language once; components use `useT` to follow changes. */
  i18n: { useT, t, registerMessages },
  theme: { useTheme },
  keymap: { useBindings, pageCloseBindings },
  notifications: { useNotifications },
  dialog: {
    useDialog,
    showDialog,
    useDialogPaddingX,
    DialogConfirm,
    ChipButton,
    ChipRow,
    DialogField,
    DialogFooter,
    DialogHeader,
    DialogLabel,
    DialogSection,
  },
  ui: { ContextMenu, FRAME, FailureHint, resolveRowSelectionChrome },
  layout: { useTerminalSize, useCursorFollow, useGlobalMouseDown, isNarrowWidth },
  text: { errorMessage, relativeAge, truncateEnd, stripNewlines, clampCursor },
  paths: { samePath, pathIdentity },
  projects: { getSavedRepos, isRemoteRepoKey, sidebarProjectLabel },
  tasks: { taskGroupIn, taskGroupLabel, taskGroupTone },
  engines: { availableEngineIds, engineDisplayName, quickForkDefaultVendor },
  attachments: { asAttachmentPaths, captureClipboardAttachment },
  issues: {
    ISSUE_STATUSES,
    ISSUE_CHAT_PLACEMENTS,
    withImagePlaceholders,
    /** Story board columns from the issue store (shared with `rove --web`). */
    board: { buildIssueBoard, applyBoardAttention, moveBoardSelection },
    /** A task's recent engine events as feed rows. */
    events: { eventRows, EVENT_FEED_LIMIT },
    /** Start an engine session on an issue; the host owns tabs and the PTY. */
    useStartChat: () => usePageServices().startIssueChat,
  },
} as const

export type PageHost = typeof pageHost
