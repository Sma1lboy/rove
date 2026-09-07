/** @jsxImportSource @opentui/react */
/**
 * The automation composer — one card, Tab between fields.
 *
 * Replaces four chained single-field prompts. Those worked, but a schedule is
 * a set of decisions you make together: the cron you want depends on what the
 * prompt does, and you cannot go back a step to reconsider. One card lets the
 * whole thing be read and edited in any order.
 *
 * The schedule field carries a live preview (`previewSchedule`) because a cron
 * expression is the one input a user cannot verify by re-reading it. Showing
 * "weekdays 09:00 · in 23h · Mon 09:00" turns a silent typo into an obviously
 * wrong line before it is ever saved.
 *
 * Field order, validation and the preview are the framework-free
 * `tui/component/automation-composer.ts`; this file is rendering + keys.
 */

import { TextAttributes } from "@opentui/core"
import { useState } from "react"
import {
  type ComposerDraft,
  type ComposerField,
  EMPTY_DRAFT,
  canSubmitDraft,
  firstIncompleteField,
  nextComposerField,
  previewSchedule,
} from "../../tui/component/automation-composer"
import {
  CRON_SEGMENTS,
  describeCron,
  moveSegmentCursor,
  setSegment,
  splitCron,
  stepSegment,
} from "../../tui/component/cron-segments"
import { clampCursor, windowAround } from "../../tui/component/new-task-dialog/state"
import { sidebarProjectLabel } from "../../tui/panes/sidebar/groups"
import { useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { DialogActions, DialogField, DialogFooter, DialogHeader, DialogSection } from "../ui/dialog-parts"
import { PickerList } from "./new-task-dialog/picker-list"

type TargetTask = { readonly id: string; readonly title: string; readonly repo: string }

export interface AutomationComposerResult extends ComposerDraft {}

function AutomationComposerView(props: {
  repos: readonly string[]
  tasks: readonly TargetTask[]
  defaultRepo?: string
  onSubmit: (draft: AutomationComposerResult) => void
  onCancel: () => void
}) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()

  const [draft, setDraft] = useState<ComposerDraft>(() => ({
    ...EMPTY_DRAFT,
    repo: props.defaultRepo ?? props.repos[0] ?? "",
  }))
  const [field, setField] = useState<ComposerField>("name")
  const [repoCursor, setRepoCursor] = useState(() => {
    const at = props.repos.indexOf(props.defaultRepo ?? "")
    return at >= 0 ? at : 0
  })
  const [error, setError] = useState<string | null>(null)
  const [segmentCursor, setSegmentCursor] = useState(0)
  const segmentValues = splitCron(draft.schedule)
  const selectSegment = (index: number): void => {
    setField("schedule")
    setSegmentCursor(Math.min(Math.max(index, 0), CRON_SEGMENTS.length - 1))
  }

  // Resolving the promise does not take the card off the dialog stack — a
  // cancel path that only calls onCancel leaves the modal up with esc dead.
  const cancel = (): void => {
    props.onCancel()
    dialog.clear()
  }

  const patch = (next: Partial<ComposerDraft>): void => {
    setDraft((prev) => ({ ...prev, ...next }))
    setError(null)
  }

  const pickRepoAt = (index: number): void => {
    const repo = props.repos[clampCursor(index, props.repos.length)]
    if (!repo) return
    setRepoCursor(clampCursor(index, props.repos.length))
    patch({ repo, target: undefined })
  }

  function commit(): void {
    if (canSubmitDraft(draft)) {
      props.onSubmit({
        name: draft.name.trim(),
        repo: draft.repo.trim(),
        prompt: draft.prompt.trim(),
        schedule: draft.schedule.trim(),
        ...(draft.target ? { target: draft.target } : {}),
      })
      dialog.clear()
      return
    }
    // Refusing silently would leave the user pressing Enter at a Create
    // button that never fires — jump to the field that is actually missing.
    const gap = firstIncompleteField(draft)
    if (gap) {
      setField(gap)
      setError(t(`automations.missing.${gap}`))
    }
  }

  const preview = previewSchedule(draft.schedule, Date.now())
  const repoWindow = windowAround(props.repos as string[], repoCursor)
  const repoRows = repoWindow.items.map((repo, index) => ({
    key: repo,
    body: sidebarProjectLabel(repo, props.repos),
    accent: repoWindow.start + index === repoCursor,
  }))

  const targets = props.tasks.filter((task) => task.repo === draft.repo)
  const targetCursor = draft.target ? targets.findIndex((task) => task.id === draft.target?.taskId) + 1 : 0
  function pickTarget(delta: number): void {
    const index = (targetCursor + delta + targets.length + 1) % (targets.length + 1)
    const task = targets[index - 1]
    patch({ target: task ? { kind: "existing-tab", taskId: task.id, tabId: "tab-1" } : undefined })
  }
  const targetLabel = draft.target
    ? (targets[targetCursor - 1]?.title ?? draft.target.taskId)
    : t("automations.targetFresh")

  useBindings(() => ({
    bindings: [
      // No escape binding: the dialog stack's ModalBarrier owns esc and both
      // resolves the promise (showDialog's onClose) and pops the card. A
      // member registration here would outrank it and only do the former.
      { key: "tab", cmd: () => setField((f) => nextComposerField(f, 1, Boolean(draft.target))) },
      { key: "shift+tab", cmd: () => setField((f) => nextComposerField(f, -1, Boolean(draft.target))) },
      // Repo is a list, so up/down drives it while it has focus. The other
      // fields are inputs — opentui owns their arrows.
      ...(field === "target"
        ? [
            { key: "up", cmd: () => pickTarget(-1) },
            { key: "down", cmd: () => pickTarget(1) },
          ]
        : []),
      ...(field === "repo"
        ? [
            { key: "up", cmd: () => pickRepoAt(repoCursor - 1) },
            { key: "down", cmd: () => pickRepoAt(repoCursor + 1) },
          ]
        : []),
      // Presets are a starting point, not a constraint: ←/→ steps through
      // them and the field stays typeable.
      // ←/→ walks the cells, ↑/↓ changes the one under the cursor.
      ...(field === "schedule"
        ? [
            { key: "left", cmd: () => setSegmentCursor((c) => moveSegmentCursor(c, -1)) },
            { key: "right", cmd: () => setSegmentCursor((c) => moveSegmentCursor(c, 1)) },
            {
              key: "up",
              cmd: () => {
                const seg = CRON_SEGMENTS[segmentCursor]
                if (!seg) return
                patch({
                  schedule: setSegment(
                    draft.schedule,
                    segmentCursor,
                    stepSegment(seg, segmentValues[segmentCursor] ?? "*", 1),
                  ),
                })
              },
            },
            {
              key: "down",
              cmd: () => {
                const seg = CRON_SEGMENTS[segmentCursor]
                if (!seg) return
                patch({
                  schedule: setSegment(
                    draft.schedule,
                    segmentCursor,
                    stepSegment(seg, segmentValues[segmentCursor] ?? "*", -1),
                  ),
                })
              },
            },
          ]
        : []),
      ...(field === "confirm" ? [{ key: "return", cmd: () => commit() }] : []),
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={1}>
      <DialogHeader title={t("automations.newTitle")} onClose={() => cancel()} />

      <DialogSection label={t("automations.fieldName")} focused={field === "name"} onPress={() => setField("name")}>
        <DialogField focused={field === "name"}>
          <input
            value={draft.name}
            placeholder={t("automations.namePlaceholder")}
            focused={field === "name"}
            onMouseUp={() => setField("name")}
            onInput={(v: string) => patch({ name: v })}
            onSubmit={() => setField(nextComposerField("name"))}
          />
        </DialogField>
      </DialogSection>

      <DialogSection
        label={t("automations.fieldRepo")}
        focused={field === "repo"}
        hint={props.repos.length === 0 ? undefined : "↑/↓"}
        onPress={() => setField("repo")}
      >
        {props.repos.length === 0 ? (
          <text fg={theme.textMuted}>{t("automations.needRepo")}</text>
        ) : (
          <DialogField focused={field === "repo"}>
            <PickerList window={repoWindow} cursor={repoCursor} rows={repoRows} onPick={pickRepoAt} />
          </DialogField>
        )}
      </DialogSection>

      <DialogSection
        label={t("automations.fieldTarget")}
        focused={field === "target"}
        hint="↑/↓"
        onPress={() => setField("target")}
      >
        <DialogField focused={field === "target"}>
          <text
            fg={theme.text}
            onMouseUp={() => {
              setField("target")
              pickTarget(1)
            }}
          >
            {targetLabel}
          </text>
        </DialogField>
      </DialogSection>
      {draft.target ? (
        <DialogSection
          label={t("automations.fieldTargetTab")}
          focused={field === "targetTab"}
          onPress={() => setField("targetTab")}
        >
          <DialogField focused={field === "targetTab"}>
            <input
              value={draft.target.tabId}
              focused={field === "targetTab"}
              onMouseUp={() => setField("targetTab")}
              onInput={(tabId: string) => {
                if (draft.target) patch({ target: { ...draft.target, tabId } })
              }}
              onSubmit={() => setField("prompt")}
            />
          </DialogField>
        </DialogSection>
      ) : null}

      <DialogSection
        label={t("automations.fieldPrompt")}
        focused={field === "prompt"}
        onPress={() => setField("prompt")}
      >
        <DialogField focused={field === "prompt"}>
          <input
            value={draft.prompt}
            placeholder={t("automations.promptPlaceholder")}
            focused={field === "prompt"}
            onMouseUp={() => setField("prompt")}
            onInput={(v: string) => patch({ prompt: v })}
            onSubmit={() => setField(nextComposerField("prompt"))}
          />
        </DialogField>
      </DialogSection>

      {/* Five cells, not a text field: ←/→ picks the cell, ↑/↓ changes it.
          Typing cron means knowing the field order before you can say
          anything, and a typo only shows up when the preview goes red. */}
      <DialogSection
        label={t("automations.fieldSchedule")}
        focused={field === "schedule"}
        hint="←/→ ↑/↓"
        onPress={() => setField("schedule")}
      >
        <DialogField focused={field === "schedule"}>
          <box flexDirection="row" gap={2}>
            {CRON_SEGMENTS.map((segment, index) => {
              const activeCell = field === "schedule" && index === segmentCursor
              return (
                <box key={segment} flexDirection="column" onMouseUp={() => selectSegment(index)}>
                  <text
                    fg={activeCell ? theme.primary : theme.text}
                    attributes={activeCell ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
                    wrapMode="none"
                  >
                    {segmentValues[index] ?? "*"}
                  </text>
                  <text fg={activeCell ? theme.textMuted : theme.borderSubtle} wrapMode="none">
                    {t(`automations.cronField.${segment}`)}
                  </text>
                </box>
              )
            })}
          </box>
          {/* The whole point of the card: a cron is unreadable, so say when it
              actually fires, in the user's own clock. */}
          {preview.kind === "ok" ? (
            <text fg={theme.success} wrapMode="none">
              {`${describeCron(draft.schedule) ?? ""}${describeCron(draft.schedule) ? " · " : ""}${preview.relative} · ${preview.absolute}`}
            </text>
          ) : (
            <text fg={theme.error} wrapMode="none">
              {preview.kind === "never" ? t("automations.cronNever") : t("automations.cronInvalid")}
            </text>
          )}
        </DialogField>
      </DialogSection>

      {error ? (
        <text fg={theme.error} wrapMode="word">
          ※ {error}
        </text>
      ) : null}

      <DialogFooter>{t("automations.composerLegend")}</DialogFooter>
      <DialogActions label={t("common.create")} focused={field === "confirm"} onPress={() => commit()} />
    </box>
  )
}

export const AutomationComposer = {
  show(
    dialog: DialogContext,
    opts: { repos: readonly string[]; tasks?: readonly TargetTask[]; defaultRepo?: string },
  ): Promise<AutomationComposerResult | undefined> {
    return showDialog<AutomationComposerResult>(dialog, (resolve) => (
      <AutomationComposerView
        repos={opts.repos}
        tasks={opts.tasks ?? []}
        {...(opts.defaultRepo ? { defaultRepo: opts.defaultRepo } : {})}
        onSubmit={(draft) => resolve(draft)}
        onCancel={() => resolve(undefined)}
      />
    ))
  },
}
