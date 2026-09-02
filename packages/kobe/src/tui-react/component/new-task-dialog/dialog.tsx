/** @jsxImportSource @opentui/react */
/**
 * The React new-task dialog JSX shell (issue #15, G3W2) — the
 * `src/tui/component/new-task-dialog/dialog.tsx` counterpart. Three
 * sibling sub-tabs share one frame (Existing / New Repo / Adopt),
 * switched with Ctrl+[ / Ctrl+] or ←/→ on the mode selector; the engine
 * selector cycles with ctrl+e. All state, effects, commit paths and key
 * bindings live in `./view-model.ts` (shared pure helpers from the Solid
 * side's `state.ts`/`clone.ts`); the tab bodies live in `./tab-*.tsx`.
 * Every user-visible string resolves through `useT()`.
 */

import { TextAttributes } from "@opentui/core"
import type { DialogTab } from "../../../tui/component/new-task-dialog/state"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { useDialogPaddingX } from "../../ui/dialog"
import { ChipButton, DialogActions, DialogFooter, DialogHeader, DialogSection } from "../../ui/dialog-parts"
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

  const tabLabel: Record<DialogTab, string> = {
    existing: t("newTask.tabs.existing"),
    clone: t("newTask.tabs.clone"),
    adopt: t("newTask.tabs.adopt"),
  }
  const tabsFocused = vm.field === "tabs"
  // Active selections keep ▸ + bold + primary; an underline marks them only
  // while that selector holds keyboard focus.
  const selectedAttrs = (selected: boolean, focused: boolean) =>
    selected ? (focused ? TextAttributes.BOLD | TextAttributes.UNDERLINE : TextAttributes.BOLD) : undefined

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={0}>
      <DialogHeader title={t("newTask.title")} onClose={() => props.onCancel()} />
      <box gap={1} paddingTop={1}>
        {/* Mode-tab selector — reachable by Tab; ←/→ switches while focused,
            ctrl+[/] from anywhere, mouse click selects. Stays a tab strip
            rather than a chip row: it navigates between three bodies, it is
            not one of the card's fields (docs/design/dialogs.md). */}
        <box flexDirection="row" gap={2}>
          {TAB_ORDER.map((tabId) => {
            const active = vm.tab === tabId
            return (
              <text
                key={tabId}
                fg={active ? theme.primary : theme.textMuted}
                attributes={selectedAttrs(active, tabsFocused)}
                onMouseUp={() => vm.switchToTab(tabId)}
              >
                {active ? `▸ ${tabLabel[tabId]}` : `  ${tabLabel[tabId]}`}
              </text>
            )
          })}
        </box>
        {/* Engine selector — Tab reaches it; ←/→ cycles while focused,
            ctrl+e from anywhere, click picks. Detected vendors only. */}
        <DialogSection
          label={t("newTask.field.engine")}
          focused={vm.field === "engine"}
          hint={t("newTask.hint.engineCycle")}
          onPress={() => vm.setField("engine")}
        >
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            {vm.vendors.map((vendor) => (
              <ChipButton
                key={vendor}
                label={vendor}
                selected={vendor === vm.vendor}
                onPress={() => {
                  vm.setVendor(vendor)
                  vm.setField("engine")
                }}
              />
            ))}
          </box>
        </DialogSection>
        {vm.tab === "existing" ? <ExistingTab vm={vm} /> : null}
        {vm.tab === "clone" ? <CloneTab vm={vm} /> : null}
        {vm.tab === "adopt" ? <AdoptTab vm={vm} /> : null}
        {vm.submitError ? (
          <text fg={theme.error} wrapMode="word">
            ※ {vm.submitError}
          </text>
        ) : null}
      </box>
      <DialogFooter>{t("newTask.legend")}</DialogFooter>
      {/* Create commits on click; also reachable by tabbing to the confirm
          field (Enter), or Enter on the last input of the active tab. */}
      <DialogActions
        label={vm.cloneInFlight ? t("newTask.button.cloning") : t("newTask.button.create")}
        focused={vm.field === "confirm"}
        onPress={() => vm.commit()}
      />
    </box>
  )
}
