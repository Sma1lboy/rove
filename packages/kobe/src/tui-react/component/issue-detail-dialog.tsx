/** @jsxImportSource @opentui/react */
/**
 * Issue-detail dialog — the kanban page's Enter surface onto one story.
 * EDITABLE: the title rides a controlled <input>, the description an
 * UNCONTROLLED <textarea> (the settings feedback-form pattern — pasted
 * newlines survive; edits mirror out through onContentChange). `tab`
 * cycles the focused field (title → description → engine → workspace);
 * arrow keys only steer engine/workspace so they never fight the inputs'
 * cursors. `esc` SAVES dirty edits and closes (ctrl+c discards).
 *
 * Images paste INLINE: a pasted image/PDF path — or a ctrl+v clipboard
 * screenshot, saved via the composer's `captureClipboardAttachment` — is
 * appended to the description as an `images[N]: /path` placeholder line.
 * The description IS the carrier: the line persists in the issue body and
 * rides the first prompt, where the engine reads the file itself. No
 * separate attachments rail.
 *
 * Resolves through the shared `showDialog` promise with the (possibly
 * edited) title/body on EVERY outcome: `{kind:"start"|"open"|"close"}`,
 * plus `{kind:"create"}` from `mode: "create"` — the same drawer doubling
 * as the board's `n` new-story intake (ctrl+s = save only, enter = save &
 * start immediately, esc = cancel). The kanban page owns the store writes.
 */

import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { usePaste } from "@opentui/react"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { type ReactNode, useRef, useState } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { ISSUE_CHAT_PLACEMENTS, type IssueChatPlacement, withImagePlaceholders } from "../../state/issue-chat"
import { stripNewlines } from "../../tui/component/new-task-dialog/state"
import { asAttachmentPaths, captureClipboardAttachment } from "../../tui/lib/attachments"
import type { VendorId } from "../../types/task"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { ChipButton, DialogField, DialogFooter, DialogHeader, DialogLabel, DialogSection } from "../ui/dialog-parts"
import { IssueEventsSection } from "./issue-detail-parts"

export interface IssueDetailOptions {
  readonly issue: Issue
  /** `create` turns the drawer into the new-story intake: blank drafts,
   *  esc CANCELS (nothing exists to save), ctrl+s creates without starting,
   *  enter/ctrl+enter creates AND starts at the chosen placement. */
  readonly mode?: "detail" | "create"
  /** Engines to offer (detected built-ins + custom), in cycle order. */
  readonly engines: readonly VendorId[]
  readonly defaultVendor: VendorId
  readonly engineLabel: (vendor: VendorId) => string
  /** Live daemon connection — the linked story's EVENTS feed reads from it.
   *  Absent (mocks, offline): the feed renders its empty state. */
  readonly orchestrator?: RemoteOrchestrator | null
}

/** Every outcome carries the drafted title/body — the page saves a dirty
 *  patch regardless of how the drawer was left. `jump` is the drawer's
 *  follow-or-stay toggle, orthogonal to placement. */
export type IssueDetailOutcome =
  | { kind: "start"; vendor: VendorId; placement: IssueChatPlacement; jump: boolean; title: string; body: string }
  | { kind: "open"; taskId: string; title: string; body: string }
  /** Drop the story's task link — the only way back out of In progress when
   *  the linked task is gone (deleted before the daemon unlinked, or a store
   *  restored from an older home). The page clears `taskId`; the task, its
   *  branch and its worktree are untouched. */
  | { kind: "unlink"; title: string; body: string }
  | { kind: "close"; title: string; body: string }
  /** Create-mode result — `start` null = save only ("New story" Save). */
  | {
      kind: "create"
      title: string
      body: string
      start: { vendor: VendorId; placement: IssueChatPlacement; jump: boolean } | null
    }

type Field = "title" | "description" | "engine" | "workspace" | "jump" | "open" | "unlink"

/** Description editor height — tall enough to read a story, short enough
 *  to keep the start config on screen. */
const DESCRIPTION_ROWS = 8

export function IssueDetailDialogView(
  props: IssueDetailOptions & {
    onSubmit: (outcome: IssueDetailOutcome) => void
    onCancel: () => void
  },
) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const issue = props.issue
  const create = props.mode === "create"
  const linkedTaskId = !create && issue.taskId && issue.taskId !== "" ? issue.taskId : null
  const startable = create || (!linkedTaskId && issue.status !== "done")

  const [vendor, setVendor] = useState<VendorId>(props.defaultVendor)
  const [placement, setPlacement] = useState<IssueChatPlacement>(ISSUE_CHAT_PLACEMENTS[0] ?? "worktree")
  // Follow-or-stay, orthogonal to placement. Default STAY: the board is
  // the tracking surface; jumping into the session is the explicit ask.
  const [jump, setJump] = useState(false)
  const [draftTitle, setDraftTitle] = useState(issue.title)
  const [draftBody, setDraftBody] = useState(issue.body)
  // Startable stories open ready to fire (enter = start from the workspace
  // field); a new story starts typing its title; linked ones open ready to
  // JUMP (enter = open the session); done-unlinked ones open on the title.
  const [field, setField] = useState<Field>(
    create ? "title" : startable ? "workspace" : linkedTaskId ? "open" : "title",
  )

  // The description is an uncontrolled <textarea> (pasted newlines survive);
  // placeholder inserts write through the ref, edits mirror into draftBody.
  const bodyEl = useRef<TextareaRenderable | null>(null)

  const fields: readonly Field[] = startable
    ? ["title", "description", "engine", "workspace", "jump"]
    : linkedTaskId
      ? ["title", "description", "open", "unlink"]
      : ["title", "description"]

  function insertPlaceholders(paths: readonly string[]): void {
    if (paths.length === 0) return
    const next = withImagePlaceholders(bodyEl.current?.plainText ?? draftBody, paths)
    bodyEl.current?.setText(next)
    setDraftBody(next)
  }

  // Pasted text that is entirely image/PDF path(s) becomes placeholder
  // lines — the quick-task composer's paste contract, aimed at the body.
  usePaste((event: { bytes: Uint8Array; preventDefault: () => void }) => {
    const paths = asAttachmentPaths(new TextDecoder().decode(event.bytes))
    if (!paths) return
    event.preventDefault()
    insertPlaceholders(paths)
  })

  function pasteClipboardImage(): void {
    void captureClipboardAttachment().then((path) => {
      if (path) insertPlaceholders([path])
    })
  }

  function cycleField(dir: 1 | -1): void {
    setField((current) => {
      const i = Math.max(0, fields.indexOf(current))
      return fields[(i + dir + fields.length) % fields.length] ?? "title"
    })
  }

  function stepEngine(dir: 1 | -1): void {
    const list = props.engines
    if (list.length === 0) return
    setVendor((v) => {
      const i = Math.max(0, list.indexOf(v))
      return list[(i + dir + list.length) % list.length] ?? v
    })
  }

  function stepPlacement(dir: 1 | -1): void {
    setPlacement((p) => {
      const i = ISSUE_CHAT_PLACEMENTS.indexOf(p)
      return ISSUE_CHAT_PLACEMENTS[(i + dir + ISSUE_CHAT_PLACEMENTS.length) % ISSUE_CHAT_PLACEMENTS.length] ?? p
    })
  }

  function draft(): { title: string; body: string } {
    return {
      title: draftTitle.trim() || issue.title,
      body: bodyEl.current?.plainText ?? draftBody,
    }
  }

  /** Create mode needs a real title — bounce focus back when it's blank. */
  function requireTitle(): boolean {
    if (draftTitle.trim().length > 0) return true
    setField("title")
    return false
  }

  function commit(): void {
    if (create) {
      if (!requireTitle()) return
      props.onSubmit({ kind: "create", start: { vendor, placement, jump }, ...draft() })
    } else if (startable) {
      props.onSubmit({ kind: "start", vendor, placement, jump, ...draft() })
    } else if (linkedTaskId) {
      props.onSubmit({ kind: "open", taskId: linkedTaskId, ...draft() })
    } else {
      return
    }
    dialog.clear()
  }

  /** ctrl+s in create mode — file the story without starting anything. */
  function saveOnly(): void {
    if (!create || !requireTitle()) return
    props.onSubmit({ kind: "create", start: null, ...draft() })
    dialog.clear()
  }

  /** Unlink and close — a stranded card's way back to Backlog. */
  function unlink(): void {
    props.onSubmit({ kind: "unlink", ...draft() })
    dialog.clear()
  }

  function close(): void {
    // Detail esc saves (there's a record to patch); create esc cancels —
    // nothing exists yet, and esc-created empty stories would be litter.
    if (create) props.onCancel()
    else props.onSubmit({ kind: "close", ...draft() })
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      // Save-and-close esc: a modal MEMBER outranks the barrier's own
      // escape, so dirty edits persist. ctrl+c (the barrier) still discards.
      { key: "escape", cmd: () => close() },
      { key: "tab", cmd: () => cycleField(1) },
      { key: "shift+tab", cmd: () => cycleField(-1) },
      { key: "ctrl+return", cmd: () => commit() },
      ...(create ? [{ key: "ctrl+s", cmd: () => saveOnly() }] : []),
      { key: "ctrl+v", cmd: () => pasteClipboardImage() },
      // Arrows steer ONLY the selector fields — in title/description they
      // must reach the input's own cursor, so they stay unregistered there.
      ...(field === "engine"
        ? [
            { key: "left", cmd: () => stepEngine(-1) },
            { key: "right", cmd: () => stepEngine(1) },
            { key: "return", cmd: () => commit() },
          ]
        : []),
      ...(field === "workspace"
        ? [
            { key: "up", cmd: () => stepPlacement(-1) },
            { key: "down", cmd: () => stepPlacement(1) },
            { key: "return", cmd: () => commit() },
          ]
        : []),
      ...(field === "jump"
        ? [
            { key: "left", cmd: () => setJump((v) => !v) },
            { key: "right", cmd: () => setJump((v) => !v) },
            { key: "return", cmd: () => commit() },
          ]
        : []),
      // The linked story's two actions — enter fires whichever is focused.
      ...(field === "open" ? [{ key: "return", cmd: () => commit() }] : []),
      ...(field === "unlink" ? [{ key: "return", cmd: () => unlink() }] : []),
    ],
  }))

  const statusFg =
    issue.status === "done"
      ? theme.success
      : issue.status === "hold"
        ? theme.warning
        : issue.status === "doing"
          ? theme.accent
          : theme.textMuted

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      {create ? (
        <DialogHeader title={t("kanban.detail.newStory")} onClose={() => close()} />
      ) : (
        <DialogHeader onClose={() => close()}>
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
              #{issue.id}
            </text>
            <text fg={statusFg} attributes={TextAttributes.BOLD} wrapMode="none">
              {t(`kanban.detail.status.${issue.status}`)}
            </text>
            <text fg={theme.textMuted} wrapMode="none">
              {t("kanban.detail.created", { date: issue.created })}
            </text>
            {linkedTaskId ? (
              <text fg={theme.accent} wrapMode="none">
                {t("kanban.detail.linked")}
              </text>
            ) : null}
          </box>
        </DialogHeader>
      )}

      {/* TITLE — controlled input, single line. Enter walks to the body. */}
      <DialogSection
        label={t("kanban.detail.titleLabel")}
        focused={field === "title"}
        onPress={() => setField("title")}
      >
        <DialogField focused={field === "title"}>
          <input
            value={draftTitle}
            focused={field === "title"}
            onMouseUp={() => setField("title")}
            onInput={(v: string) => setDraftTitle(stripNewlines(v))}
            onSubmit={() => setField("description")}
          />
        </DialogField>
      </DialogSection>

      {/* DESCRIPTION — uncontrolled multiline editor; pasted image paths and
          ctrl+v screenshots append `images[N]: /path` placeholder lines. */}
      <DialogSection
        label={t("kanban.detail.description")}
        focused={field === "description"}
        hint={t("kanban.detail.attachHint")}
        onPress={() => setField("description")}
      >
        <DialogField focused={field === "description"}>
          <textarea
            ref={(el: TextareaRenderable | null) => {
              bodyEl.current = el
            }}
            initialValue={issue.body}
            placeholder={t("kanban.detail.noDescription")}
            focused={field === "description"}
            height={DESCRIPTION_ROWS}
            wrapMode="word"
            onMouseUp={() => setField("description")}
            onContentChange={() => setDraftBody(bodyEl.current?.plainText ?? "")}
          />
        </DialogField>
      </DialogSection>

      {startable ? (
        <box gap={0}>
          {/* ENGINE — chip buttons; selected = active border + primary bold. */}
          <DialogSection label={t("kanban.detail.engine")} focused={field === "engine"} hint="←/→">
            <box flexDirection="row" gap={1}>
              {props.engines.map((engine) => (
                <ChipButton
                  key={engine}
                  label={props.engineLabel(engine)}
                  selected={engine === vendor}
                  paddingBottom={1}
                  onPress={() => {
                    setField("engine")
                    setVendor(engine)
                  }}
                />
              ))}
            </box>
          </DialogSection>

          {/* WORKSPACE — the three placements as one grouped, bordered list. */}
          <DialogSection
            label={t("kanban.detail.workspace")}
            focused={field === "workspace"}
            hint="↑/↓"
            paddingBottom={1}
          >
            <DialogField focused={field === "workspace"}>
              {ISSUE_CHAT_PLACEMENTS.map((option) => {
                const active = option === placement
                return (
                  <text
                    key={option}
                    fg={active ? theme.primary : theme.textMuted}
                    attributes={active ? TextAttributes.BOLD : undefined}
                    onMouseUp={() => {
                      setField("workspace")
                      setPlacement(option)
                    }}
                  >
                    {active ? "▸ " : "  "}
                    {t(`kanban.detail.placement.${option}`)}
                  </text>
                )
              })}
            </DialogField>
          </DialogSection>

          {/* AFTER START — follow the session or stay on the board;
              orthogonal to placement (all three support both). */}
          <DialogSection label={t("kanban.detail.jumpLabel")} focused={field === "jump"} hint="←/→" paddingBottom={1}>
            <box flexDirection="row" gap={1}>
              {([false, true] as const).map((option) => (
                <ChipButton
                  key={String(option)}
                  label={t(option ? "kanban.detail.jump.follow" : "kanban.detail.jump.stay")}
                  selected={option === jump}
                  onPress={() => {
                    setField("jump")
                    setJump(option)
                  }}
                />
              ))}
            </box>
          </DialogSection>

          <DialogFooter>{create ? t("kanban.detail.createLegend") : t("kanban.detail.startLegend")}</DialogFooter>
        </box>
      ) : linkedTaskId ? (
        <box gap={1}>
          {/* SESSION — jump to the story's running workspace (mouse or
              enter; the board closes and the task activates), and the way
              back out: Unlink returns the card to Backlog. Unlink is the
              only recovery when the linked task no longer exists — the
              Open action would then jump at nothing. */}
          <DialogSection label={t("kanban.detail.sessionLabel")} focused={field === "open"}>
            <box flexDirection="row" gap={1}>
              <ChipButton
                label={t("kanban.detail.openAction")}
                selected={field === "open"}
                tone="text"
                onPress={() => {
                  setField("open")
                  commit()
                }}
              />
              <ChipButton
                label={t("kanban.detail.unlinkAction")}
                selected={field === "unlink"}
                onPress={() => {
                  setField("unlink")
                  unlink()
                }}
              />
            </box>
          </DialogSection>
          {/* EVENTS — what the linked session's engine has been doing. */}
          <IssueEventsSection taskId={linkedTaskId} orchestrator={props.orchestrator ?? null} />
          <DialogFooter>{t("kanban.detail.openLegend")}</DialogFooter>
        </box>
      ) : (
        <DialogFooter>{t("kanban.detail.doneNote")}</DialogFooter>
      )}
    </box>
  )
}

function show(dialog: DialogContext, opts: IssueDetailOptions): Promise<IssueDetailOutcome | undefined> {
  return showDialog<IssueDetailOutcome>(
    dialog,
    (resolve) => (
      <IssueDetailDialogView {...opts} onSubmit={(outcome) => resolve(outcome)} onCancel={() => resolve(undefined)} />
    ),
    { size: "large" },
  )
}

export const IssueDetailDialog = { show }
