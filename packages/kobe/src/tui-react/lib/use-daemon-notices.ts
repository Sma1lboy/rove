/**
 * Bridge daemon broadcasts (`kobe api notify`, tab open/close/rename,
 * prompts) into the host. Channels replay their last value on connect, so
 * every bridge dedupes on `at` (unique per publish) and drops replays older
 * than {@link STALE_NOTICE_MS}.
 */

import type {
  NoticeEventPayload,
  TabClosePayload,
  TabOpenPayload,
  TabRenamePayload,
  UiPromptPayload,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import { useEffect, useRef } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { createStateCell } from "../../lib/external-store"
import type { NotifyInput } from "../../tui/lib/notify-state"
import { RenameTaskDialog } from "../component/rename-task-dialog"
import { useKV } from "../context/kv"
import { t } from "../i18n"
import type { DialogContext } from "../ui/dialog"
import { closeTaskTab } from "../workspace/terminal-tabs-close"
import { renameTaskTab } from "../workspace/terminal-tabs-rename"
import { requestPaneClose, requestTabOpen } from "../workspace/terminal-tabs-shared"
import { useAccessor } from "./use-accessor"

/** Replays older than this never toast — they're reconnect echoes, not news. */
const STALE_NOTICE_MS = 10_000

/** Stable empty store so the hook stays unconditional when no daemon is attached. */
const NO_NOTICES = createStateCell<NoticeEventPayload | null>(null)
const NO_TAB_OPENS = createStateCell<TabOpenPayload | null>(null)
const NO_TAB_CLOSES = createStateCell<TabClosePayload | null>(null)
const NO_TAB_RENAMES = createStateCell<TabRenamePayload | null>(null)
const NO_PROMPTS = createStateCell<UiPromptPayload | null>(null)

/** `tab.open` (plugin panes) → the pending tab-open request TerminalTabs consumes. */
function useDaemonTabOpens(orch: RemoteOrchestrator | null): void {
  const request = useAccessor(orch ? orch.tabOpenStore() : NO_TAB_OPENS)
  const seenAt = useRef<number | null>(null)
  useEffect(() => {
    if (!request || request.at === seenAt.current) return
    seenAt.current = request.at
    if (Date.now() - request.at > STALE_NOTICE_MS) return
    requestTabOpen(request.taskId, request.argv, request.title, request.placement, request.direction, request.tabId)
  }, [request])
}

/** Bridge pane-close and exact Terminal Tab close broadcasts. */
function useDaemonTabCloses(orch: RemoteOrchestrator | null): void {
  const kv = useKV()
  const request = useAccessor(orch ? orch.tabCloseStore() : NO_TAB_CLOSES)
  const seenAt = useRef<number | null>(null)
  useEffect(() => {
    if (!request || request.at === seenAt.current) return
    seenAt.current = request.at
    if (Date.now() - request.at > STALE_NOTICE_MS) return
    if ("requestId" in request) {
      const closed = closeTaskTab(kv, request.taskId, request.tabId)
      orch?.replyTerminalTabClose(request.requestId, closed)
      return
    }
    requestPaneClose(request.taskId, request.title, request.tabId)
  }, [request, kv, orch])
}

/** `tab.rename` (`rove api rename --tab`): the CLI already persisted it, so
 *  this is the repaint half, with no reply. */
function useDaemonTabRenames(orch: RemoteOrchestrator | null): void {
  const kv = useKV()
  const request = useAccessor(orch ? orch.tabRenameStore() : NO_TAB_RENAMES)
  const seenAt = useRef<number | null>(null)
  useEffect(() => {
    if (!request || request.at === seenAt.current) return
    seenAt.current = request.at
    if (Date.now() - request.at > STALE_NOTICE_MS) return
    renameTaskTab(kv, request.taskId, request.tabId, request.title)
  }, [request, kv])
}

/**
 * `ui.prompt` → input dialog, answered via `ui.promptReply` (undefined =
 * cancel). First attached TUI to answer wins; the daemon drops the rest.
 */
function useDaemonPrompts(orch: RemoteOrchestrator | null, dialog: DialogContext): void {
  const request = useAccessor(orch ? orch.uiPromptStore() : NO_PROMPTS)
  const seenAt = useRef<number | null>(null)
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog
  useEffect(() => {
    if (!orch || !request || request.at === seenAt.current) return
    seenAt.current = request.at
    if (Date.now() - request.at > STALE_NOTICE_MS) return
    void RenameTaskDialog.show(dialogRef.current, request.initial ?? "", {
      dialogTitle: request.title,
      fieldLabel: t("common.prompt.fieldLabel"),
      submitLabel: t("common.prompt.submitLabel"),
      placeholder: request.placeholder ?? "",
      allowEmpty: true,
    }).then((value) => orch.replyPrompt(request.promptId, value))
  }, [request, orch])
}

export function useDaemonNotices(
  orch: RemoteOrchestrator | null,
  notify: (input: NotifyInput) => void,
  dialog: DialogContext,
): void {
  useDaemonTabOpens(orch)
  useDaemonTabCloses(orch)
  useDaemonTabRenames(orch)
  useDaemonPrompts(orch, dialog)
  const notice = useAccessor(orch ? orch.noticeStore() : NO_NOTICES)
  const seenAt = useRef<number | null>(null)
  const notifyRef = useRef(notify)
  notifyRef.current = notify
  useEffect(() => {
    if (!notice || notice.at === seenAt.current) return
    seenAt.current = notice.at
    if (Date.now() - notice.at > STALE_NOTICE_MS) return
    // Any kind is allowed on the wire; unknown ones render as "done".
    const kind = notice.kind === "needs_input" || notice.kind === "error" ? notice.kind : "done"
    notifyRef.current({
      kind,
      taskId: notice.taskId ?? "",
      tabId: "",
      title: notice.title,
      ...(notice.body ? { body: notice.body } : {}),
    })
  }, [notice])
}
