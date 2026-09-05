/** @jsxImportSource @opentui/react */
/**
 * Issue-detail dialog — the kanban page's Enter surface onto one story.
 * EDITABLE: the title rides a controlled <input>, the description an
 * UNCONTROLLED <textarea> (the settings feedback-form pattern — pasted
 * newlines survive; edits mirror out through onContentChange). `tab`
 * cycles the focused field (title → description → status → engine →
 * workspace); arrow keys only steer the selector fields so they never fight
 * the inputs' cursors. `esc` SAVES dirty edits and closes (ctrl+c discards).
 *
 * STATUS is in that cycle because this drawer is the only place a human can
 * move a card out of Backlog/In progress: the board's own keys steer the
 * cursor, and `d` deletes. Without it "I finished this" and "this never
 * existed" were the same gesture. It is deliberately a field here rather than
 * a new board chord — the cycle already existed, a chord would be new.
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
import { ISSUE_STATUSES, type Issue, type IssueStatus } from "@sma1lboy/kobe-daemon/daemon/issues-store"
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
import {
  ChipButton,
  ChipRow,
  DialogField,
  DialogFooter,
  DialogHeader,
  DialogLabel,
  DialogSection,
} from "../ui/dialog-parts"
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

/** The drafted title/body/status every non-create outcome carries — the page
 *  saves a dirty patch regardless of how the drawer was left. */
interface IssueDraft {
  readonly title: string
  readonly body: string
  readonly status: IssueStatus
}

/** Every outcome carries the drafted title/body/status — the page saves a
 *  dirty patch regardless of how the drawer was left. `jump` is the drawer's
 *  follow-or-stay toggle, orthogonal to placement. */
export type IssueDetailOutcome =
  | ({ kind: "start"; vendor: VendorId; placement: IssueChatPlacement; jump: boolean } & IssueDraft)
  | ({ kind: "open"; taskId: string } & IssueDraft)
  /** Drop the story's task link — the only way back out of In progress when
   *  the linked task is gone (deleted before the daemon unlinked, or a store
   *  restored from an older home). The page clears `taskId`; the task, its
   *  branch and its worktree are untouched. */
  | ({ kind: "unlink" } & IssueDraft)
  | ({ kind: "close" } & IssueDraft)
  /** Create-mode result — `start` null = save only ("New story" Save). */
  | {
      kind: "create"
      title: string
      body: string
      start: { vendor: VendorId; placement: IssueChatPlacement; jump: boolean } | null
    }

type Field = "title" | "description" | "status" | "engine" | "workspace" | "jump" | "open" | "unlink"

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
  const [draftStatus, setDraftStatus] = useState<IssueStatus>(issue.status)
  // Startable stories open ready to fire (enter = start from the workspace
  // field); a new story starts typing its title; linked ones open ready to
  // JUMP (enter = open the session); done-unlinked ones open on the title.
  const [field, setField] = useState<Field>(
    create ? "title" : startable ? "workspace" : linkedTaskId ? "open" : "title",
  )

  // The description is an uncontrolled <textarea> (pasted newlines survive);
  // placeholder inserts write through the ref, edits mirror into draftBody.
  const bodyEl = useRef<TextareaRenderable | null>(null)

  // `status` joins every DETAIL cycle and no create cycle: a story that does
  // not exist yet is `open` by construction, and offering to file it as
  // `done` would be a trap. It sits right after the text fields so the move
  // that closes a card is two tabs away in all three shapes.
  const fields: readonly Field[] = create
    ? ["title", "description", "engine", "workspace", "jump"]
    : startable
      ? ["title", "description", "status", "engine", "workspace", "jump"]
      : linkedTaskId
        ? ["title", "description", "status", "open", "unlink"]
        : ["title", "description", "status"]

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

  function draft(): IssueDraft {
    return {
      title: draftTitle.trim() || issue.title,
      body: bodyEl.current?.plainText ?? draftBody,
      status: draftStatus,
    }
  }

  function stepStatus(dir: 1 | -1): void {
    setDraftStatus((s) => {
      const i = Math.max(0, ISSUE_STATUSES.indexOf(s))
      return ISSUE_STATUSES[(i + dir + ISSUE_STATUSES.length) % ISSUE_STATUSES.length] ?? s
    })
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
      const { title, body } = draft()
      props.onSubmit({ kind: "create", start: { vendor, placement, jump }, title, body })
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
    const { title, body } = draft()
    props.onSubmit({ kind: "create", start: null, title, body })
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
      // Status has no `return` of its own: enter on a done/parked story would
      // otherwise fall through to `commit()`, which starts a session.
      ...(field === "status"
        ? [
            { key: "left", cmd: () => stepStatus(-1) },
            { key: "right", cmd: () => stepStatus(1) },
          ]
        : []),
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

  // Keyed on the DRAFT, not the open-time snapshot: the header badge is the
  // confirmation that the status field's ←/→ landed.
  const statusFg =
    draftStatus === "done"
      ? theme.success
      : draftStatus === "hold"
        ? theme.warning
        : draftStatus === "doing"
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
              {t(`kanban.detail.status.${draftStatus}`)}
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

      {/* STATUS — the card's column, as a chip row. Detail mode only: this is
          the human's only route out of Backlog / In progress, since the board
          itself is read-only and `d` deletes rather than closes. */}
      {create ? null : (
        <DialogSection
          label={t("kanban.detail.statusLabel")}
          focused={field === "status"}
          hint="←/→"
          paddingBottom={1}
          onPress={() => setField("status")}
        >
          <ChipRow
            choices={ISSUE_STATUSES}
            selected={draftStatus}
            display={(option) => t(`kanban.detail.status.${option}`)}
            onPick={(option) => {
              setField("status")
              setDraftStatus(option)
            }}
          />
        </DialogSection>
      )}

      {startable ? (
        <box gap={0}>
          {/* ENGINE — chip buttons; selected = active border + primary bold. */}
          <DialogSection label={t("kanban.detail.engine")} focused={field === "engine"} hint="←/→">
            <ChipRow
              choices={props.engines}
              selected={vendor}
              display={props.engineLabel}
              paddingBottom={1}
              onPick={(engine) => {
                setField("engine")
                setVendor(engine)
              }}
            />
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
            <ChipRow
              choices={["stay", "follow"] as const}
              selected={jump ? "follow" : "stay"}
              display={(option) => t(option === "follow" ? "kanban.detail.jump.follow" : "kanban.detail.jump.stay")}
              onPick={(option) => {
                setField("jump")
                setJump(option === "follow")
              }}
            />
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
