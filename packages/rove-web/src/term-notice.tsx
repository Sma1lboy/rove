/**
 * The strip over a terminal that has nothing running in it: a session that ended, was restored, never
 * started, failed to attach, or lost its engine inside a still-running shell. Each state carries the
 * next step, so a dead pane is never a dead end.
 */

import { t, useLocale } from "./i18n/index.ts"
import type { AppModel } from "./model.ts"
import { NewChatDialog } from "./new-chat-dialog.tsx"
import { SettingsDialog } from "./settings-view.tsx"
import type { Notice } from "./term-mount.ts"
import { dialog } from "./ui.ts"
import { TERM_NOTICE_TOUCH, termNotice } from "./ui/shell.ts"

/** The tab's engine ended while its fallback shell kept the session up (the daemon marked the tab dead). */
export interface EngineExit {
  readonly code: number | null
  /** When the daemon marked it (ms epoch): a retry that dies again is a new exit. */
  readonly since: number
}

function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "restored":
      return t("workspace.restored")
    case "notLive":
      return t("workspace.tabNotLive")
    case "exited":
      return t("workspace.exited", { code: notice.code ?? "?" })
    case "failed":
      return t("workspace.attachFailed", { message: notice.message })
    case "none":
      return ""
  }
}

export function TermNotice(props: {
  readonly notice: Notice
  readonly engineExit: EngineExit | null
  readonly model: AppModel
  readonly taskId: string
  readonly revive: { readonly busy: boolean; readonly error: string | null }
  /** Reopen the tab's own session; `true` also replaces a running one whose engine has exited. Absent for a split pane. */
  readonly onReopen?: (restartExited: boolean) => void
  /** Attach again after a failed attach. */
  readonly onRetryAttach?: () => void
}) {
  useLocale()
  const { notice, engineExit, model, taskId, revive } = props
  const lostEngine = notice.kind === "none" ? engineExit : null
  if (notice.kind === "none" && !lostEngine) return null

  const reopenable = notice.kind === "notLive" || notice.kind === "restored" || notice.kind === "exited"
  const gone = notice.kind === "exited" || lostEngine !== null
  const text = revive.error
    ? t("workspace.reopenFailed", { message: revive.error })
    : lostEngine
      ? t("workspace.engineExited", { code: lostEngine.code ?? "?" })
      : noticeText(notice)

  return (
    <div className={`${termNotice(notice.kind === "failed" || !!revive.error)} ${TERM_NOTICE_TOUCH}`}>
      <span>{text}</span>
      {props.onReopen && (reopenable || lostEngine) && (
        <button
          type="button"
          className="link text-accent"
          disabled={revive.busy}
          onClick={() => props.onReopen?.(lostEngine !== null)}
        >
          {revive.busy ? t("workspace.reopening") : lostEngine ? t("workspace.retry") : t("workspace.reopen")}
        </button>
      )}
      {notice.kind === "failed" && props.onRetryAttach && (
        <button type="button" className="link text-accent" onClick={props.onRetryAttach}>
          {t("workspace.retry")}
        </button>
      )}
      {gone && (
        <>
          <button
            type="button"
            className="link text-accent"
            onClick={() => dialog.set(<SettingsDialog model={model} section="engines" />)}
          >
            {t("workspace.engineSettings")}
          </button>
          <button
            type="button"
            className="link text-accent"
            onClick={() => dialog.set(<NewChatDialog model={model} taskId={taskId} />)}
          >
            {t("menu.newChatPick")}
          </button>
        </>
      )}
    </div>
  )
}
