/** @jsxImportSource @opentui/react */
/**
 * The new-task dialog's JSX shell. Three sibling sub-tabs share one frame
 * (Existing / New Repo / Adopt), a chip row switched with Ctrl+[ / Ctrl+] or
 * ←/→ while focused; the engine selector cycles with ctrl+e. All state, effects,
 * commit paths and key bindings live in `./view-model.ts` (pure helpers in
 * `state.ts`/`clone.ts`); the tab bodies live in `./tab-*.tsx`. Every
 * user-visible string resolves through `useT()`.
 */

import type { DialogTab } from "../../../tui/component/new-task-dialog/state"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useDialogPaddingX } from "../../ui/dialog"
import { DialogBody } from "../../ui/dialog-body"
import { ChipRow, DialogActions, DialogFooter, DialogHeader, DialogSection } from "../../ui/dialog-parts"
import { ModelSection } from "../model-field"
import { AdoptTab } from "./tab-adopt"
import { CloneTab } from "./tab-clone"
import { ExistingTab } from "./tab-existing"
import { type NewTaskDialogProps, TIER_CHOICES, useNewTaskViewModel } from "./view-model"

export type { NewTaskDialogProps } from "./view-model"

const TAB_ORDER: readonly DialogTab[] = ["existing", "clone", "adopt"]

export function NewTaskDialogView(props: NewTaskDialogProps) {
  const { theme } = useTheme()
  const t = useT()
  const padX = useDialogPaddingX()
  const vm = useNewTaskViewModel(props)

  const tabLabel: Record<DialogTab, string> = {
    existing: t("newTask.tabs.existing"),
    clone: t("newTask.tabs.clone"),
    adopt: t("newTask.tabs.adopt"),
  }

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={0} flexShrink={1} overflow="hidden">
      {/* Scrolling border glyphs must not repaint the fixed title row. */}
      <box flexShrink={0} zIndex={1} backgroundColor={theme.backgroundDialog}>
        <DialogHeader title={t("newTask.title")} onClose={() => props.onCancel()} />
      </box>
      <DialogBody>
        {/* Mode selector — Tab reaches it; ←/→ switches while focused,
            ctrl+[/] from anywhere, click picks. Same chip row as every
            other choose-one in this dialog. */}
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
        {/* Auto-effort tier — only while the table is configured. A pick
            fills the engine/effort/model rows below; editing any of them
            reads as "manual" again. The muted line says what the selected
            depth means, in words that name no engine. */}
        {vm.tierVisible ? (
          <DialogSection
            label={t("newTask.field.tier")}
            focused={vm.field === "tier"}
            hint="←/→"
            onPress={() => vm.setField("tier")}
          >
            <ChipRow
              choices={TIER_CHOICES}
              selected={vm.tier}
              display={(choice) => t(`tasks.tier.${choice}`)}
              onPick={(choice) => {
                vm.pickTier(choice)
                vm.setField("tier")
              }}
            />
            {vm.tier !== "manual" ? (
              <text fg={theme.textMuted} wrapMode="word">
                {t(`tasks.tierDesc.${vm.tier}`)}
              </text>
            ) : null}
          </DialogSection>
        ) : null}
        {/* Engine selector — Tab reaches it; ←/→ cycles while focused,
            ctrl+e from anywhere, click picks. Detected vendors only. */}
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
        {/* Model — only for an engine that declares a model flag; the shared
            input + suggestions row (`model-field.tsx`). */}
        {vm.modelVisible ? (
          <ModelSection
            field={vm.modelField}
            focused={vm.field === "model"}
            onFocus={() => vm.setField("model")}
            onSubmit={() => vm.advanceFrom("model")}
          />
        ) : null}
        {/* Reasoning level — only for an engine that declares levels; the
            same chips the change-engine picker shows. */}
        {vm.effortChoices.length > 0 ? (
          <DialogSection
            label={t("newTask.field.effort")}
            focused={vm.field === "effort"}
            hint="←/→"
            onPress={() => vm.setField("effort")}
          >
            <ChipRow
              choices={vm.effortChoices}
              selected={vm.effort}
              display={(choice) => (choice === "" ? t("tasks.changeEngine.noEffort") : choice)}
              onPick={(choice) => {
                vm.setEffort(choice)
                vm.setField("effort")
              }}
            />
          </DialogSection>
        ) : null}
        {vm.tab === "existing" ? <ExistingTab vm={vm} /> : null}
        {vm.tab === "clone" ? <CloneTab vm={vm} /> : null}
        {vm.tab === "adopt" ? <AdoptTab vm={vm} /> : null}
      </DialogBody>
      {vm.submitError ? (
        <text fg={theme.error} wrapMode="word" flexShrink={0}>
          ※ {vm.submitError}
        </text>
      ) : null}
      {/* Enter's caption follows the focused stop: it commits only on Create
          and walks the form at the other four, so a static "enter create" was
          wrong at every stop the dialog actually opens on. */}
      <DialogFooter paddingBottom={0}>
        {t("newTask.legend", {
          enter: t(vm.field === "confirm" ? "newTask.enterCreate" : "newTask.enterNext"),
        })}
      </DialogFooter>
      {/* Create commits on click; also reachable by tabbing to the confirm
          field (Enter), or Enter on the last input of the active tab. */}
      <DialogActions
        paddingTop={0}
        label={vm.cloneInFlight ? t("newTask.button.cloning") : t("newTask.button.create")}
        focused={vm.field === "confirm"}
        onPress={() => vm.commit()}
      />
    </box>
  )
}
