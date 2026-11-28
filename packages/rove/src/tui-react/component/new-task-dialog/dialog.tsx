/** @jsxImportSource @opentui/react */
/**
 * The new-task form's JSX shell (a page: `./index.tsx`). Three sibling sub-tabs share one frame
 * (Existing / New Repo / Adopt), a chip row switched with Ctrl+[ / Ctrl+] or
 * ←/→ while focused; the engine selector cycles with ctrl+e. All state, effects,
 * commit paths and key bindings live in `./view-model.ts` (pure helpers in
 * `state.ts`/`clone.ts`); the tab bodies live in `./tab-*.tsx`. Every
 * user-visible string resolves through `useT()`.
 */

import { TextAttributes } from "@opentui/core"
import { DEFAULT_BASE_REF } from "@sma1lboy/rove-core/worktree/git-snapshot.ts"
import { type DialogTab, splitRepoRow } from "../../../tui/component/new-task-dialog/state"
import { effortLabel } from "../../../tui/lib/effort-glyph"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useTerminalSize } from "../../lib/use-terminal-size"
import { useDialogPaddingX } from "../../ui/dialog"
import { DialogBody } from "../../ui/dialog-body"
import {
  ChipButton,
  ChipRow,
  DialogActions,
  DialogField,
  DialogFooter,
  DialogHeader,
  DialogSection,
} from "../../ui/dialog-parts"
import { INPUT_SCROLL } from "../../ui/input-scroll"
import { CelestialPlate, PLATE_ROWS } from "../celestial-plate"
import { EngineHookReadiness } from "../engine-hook-readiness"
import { FailureHint } from "../failure-hint"
import { ModelSection } from "../model-field"
import { AdoptTab } from "./tab-adopt"
import { CloneTab } from "./tab-clone"
import { ExistingTab } from "./tab-existing"
import { type NewTaskDialogProps, useNewTaskViewModel } from "./view-model"

export type { NewTaskDialogProps } from "./view-model"

const TAB_ORDER: readonly DialogTab[] = ["existing", "clone", "adopt"]

export function NewTaskDialogView(props: NewTaskDialogProps) {
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const vm = useNewTaskViewModel(props)
  // The sky is decoration: it shows only where the composer and an open picker still fit under it.
  const plateFits = useTerminalSize().height >= PLATE_ROWS + 26

  const tabLabel: Record<DialogTab, string> = {
    existing: t("newTask.tabs.existing"),
    clone: t("newTask.tabs.clone"),
    adopt: t("newTask.tabs.adopt"),
  }

  const composer = vm.tab === "existing"
  /** In the composer layout a field is a chip until it has focus. */
  const shown = (field: string) => !composer || vm.field === field

  const modeSection = shown("tabs") ? (
    <DialogSection
      label={t("newTask.field.mode")}
      focused={vm.field === "tabs"}
      hint={t("newTask.hint.modeCycle")}
      onPress={() => vm.setField("tabs")}
    >
      <ChipRow
        choices={TAB_ORDER}
        selected={vm.tab}
        display={(tabId) => tabLabel[tabId]}
        onPick={(tabId) => vm.switchToTab(tabId)}
      />
    </DialogSection>
  ) : null
  const engineSection = shown("engine") ? (
    <DialogSection
      label={t("newTask.field.engine")}
      focused={vm.field === "engine"}
      hint={t("newTask.hint.engineCycle")}
      onPress={() => vm.setField("engine")}
    >
      <ChipRow
        choices={vm.vendors}
        selected={vm.vendor}
        onPick={(vendor) => {
          vm.setVendor(vendor)
          vm.setField("engine")
        }}
      />
    </DialogSection>
  ) : null
  // Model and effort come from the engine's registry entry and show only for engines that declare them.
  const modelSection =
    vm.modelVisible && shown("model") ? (
      <ModelSection
        field={vm.modelField}
        focused={vm.field === "model"}
        onFocus={() => vm.setField("model")}
        onSubmit={() => vm.advanceFrom("model")}
      />
    ) : null
  const effortText = (choice: string) =>
    choice === "" ? t("tasks.changeEngine.noEffort") : effortLabel(vm.effortChoices.slice(1), choice)
  const effortSection =
    vm.effortChoices.length > 0 && shown("effort") ? (
      <DialogSection
        label={t("newTask.field.effort")}
        focused={vm.field === "effort"}
        hint="←/→"
        onPress={() => vm.setField("effort")}
      >
        <ChipRow
          choices={vm.effortChoices}
          selected={vm.effort}
          display={effortText}
          onPick={(choice) => {
            vm.setEffort(choice)
            vm.setField("effort")
          }}
        />
      </DialogSection>
    ) : null
  const error = vm.submitError ? (
    <box>
      <text fg={theme.error} wrapMode="word" flexShrink={0}>
        ※ {vm.submitError}
      </text>
      <FailureHint hint={t("newTask.retryHint")} />
    </box>
  ) : null
  // Enter's caption follows the focused stop: it commits on the first message
  // and on Create, toggles the row on a pick list, and walks the form elsewhere.
  const legend = (
    <DialogFooter paddingBottom={0}>
      {t("newTask.legend", {
        enter: t(
          vm.field === "confirm" || vm.field === "prompt"
            ? "newTask.enterCreate"
            : vm.field === "extras" || vm.field === "adoptFilter"
              ? "newTask.enterSelect"
              : "newTask.enterNext",
        ),
      })}
    </DialogFooter>
  )
  const create = (
    <DialogActions
      paddingTop={0}
      paddingBottom={composer && !(vm.intent === "project" && vm.canOpenProject) ? 0 : 1}
      label={vm.cloneInFlight ? t("newTask.button.cloning") : t("newTask.button.create")}
      focused={vm.field === "confirm"}
      onPress={() => vm.commit()}
    />
  )

  if (composer) {
    const project = vm.intent === "project" && vm.canOpenProject
    const chip = (field: Parameters<typeof vm.setField>[0], label: string) => (
      <ChipButton label={label} selected={vm.field === field} tone="text" onPress={() => vm.setField(field)} />
    )
    return (
      <box paddingLeft={padX} paddingRight={padX} paddingBottom={1} gap={0} flexGrow={1} overflow="hidden">
        {/* The pane's empty space sits above the composer; a focused chip's
            picker opens into it, so the composer never moves. */}
        <box flexGrow={1} flexShrink={1} minHeight={0} justifyContent="center" alignItems="center" overflow="hidden">
          {plateFits ? <CelestialPlate /> : null}
          <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none">
            {t("newTask.title")}
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {t("newTask.hero")}
          </text>
        </box>
        {modeSection}
        {engineSection}
        <EngineHookReadiness vendor={vm.vendor} />
        {modelSection}
        {effortSection}
        <ExistingTab vm={vm} only />
        {project ? null : (
          <DialogField focused={vm.field === "prompt"}>
            <input
              {...INPUT_SCROLL}
              value={vm.prompt}
              placeholder={t("newTask.placeholder.prompt")}
              focused={vm.field === "prompt"}
              onMouseUp={() => vm.setField("prompt")}
              onInput={(v: string) => vm.setPrompt(v)}
              onSubmit={() => vm.commitExisting()}
            />
            {/* Create sits on the box's last row, under a two-row gap. */}
            <box height={2} flexShrink={0} />
            {create}
          </DialogField>
        )}
        {/* Wraps by whole groups: a long repo name pushes the engine chips to a second row rather than off the edge. */}
        <box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1} flexShrink={0}>
          <box flexDirection="row" columnGap={1} flexShrink={0}>
            {chip("repo", vm.noFolder ? t("newTask.chooseFolder") : splitRepoRow(vm.repo.trim()).base)}
            {vm.extraCandidates.length > 0 && !project && !vm.noFolder
              ? chip("extras", vm.extraPicked.length > 0 ? `+${vm.extraPicked.length}` : "+")
              : null}
            {vm.canOpenProject ? chip("intent", t(project ? "newTask.chipProject" : "newTask.chipWorktree")) : null}
            {project || vm.noFolder ? null : chip("baseRef", vm.baseRef.trim() || DEFAULT_BASE_REF)}
          </box>
          <box flexDirection="row" columnGap={1} flexShrink={0}>
            {chip("engine", vm.vendor)}
            {vm.modelVisible
              ? chip("model", vm.modelField.value.trim() || t("tasks.engineModel.label").toLowerCase())
              : null}
            {vm.effortChoices.length > 0
              ? chip("effort", vm.effort === "" ? t("newTask.field.effort").toLowerCase() : effortText(vm.effort))
              : null}
            {chip("tabs", "⋯")}
          </box>
        </box>
        {project ? create : null}
        {error}
        {legend}
      </box>
    )
  }

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={0} flexShrink={1} overflow="hidden">
      <box flexShrink={0}>
        <DialogHeader title={t("newTask.title")} onClose={() => props.onCancel()} />
      </box>
      <DialogBody>
        {modeSection}
        {engineSection}
        <EngineHookReadiness vendor={vm.vendor} />
        {modelSection}
        {effortSection}
        {vm.tab === "clone" ? <CloneTab vm={vm} /> : null}
        {vm.tab === "adopt" ? <AdoptTab vm={vm} /> : null}
      </DialogBody>
      {error}
      {legend}
      {create}
    </box>
  )
}
