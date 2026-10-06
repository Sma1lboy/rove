/** @jsxImportSource @opentui/react */
/**
 * The one "start a new chat" dialog. Default: the `chat.tab.chooseEngine`
 * (ctrl+e) picker — engines (+ shell + plugin panes), ←/→ cycles, enter opens
 * a fresh tab here. Two toggles, each its own chip row:
 *
 *   - `tab`    — destination: new tab here → fork a child task worktree →
 *                a Scratch task in $HOME (engine or bare shell)
 *   - `ctrl+f` — context: fresh conversation ⇄ continue the current one
 *
 * Shell/plugin panes can't continue a conversation or live in a fork, so
 * those combos narrow to engines and clamp the highlight. Scratch is always
 * fresh: flipping to continue there drops back to a tab here.
 *
 * `ctrl+a c` / `ctrl+a f` preset a toggle; submit dispatch lives in
 * `use-tab-dialogs.ts`.
 */

import { DEFAULT_TASK_VENDOR } from "@/types/task"
import { ALL_VENDORS, type VendorId } from "@/types/vendor"
import { useState } from "react"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { type DialogContext, showDialog, useDialog, useDialogPaddingX } from "../ui/dialog"
import { ChipRow, DialogFooter, DialogHeader, DialogSection } from "../ui/dialog-parts"

/** What the picker can resolve to: an engine vendor or a plain shell. With
 *  `extraChoices`, an extra choice's `key` (e.g. a plugin pane) too. */
export type EnginePick = VendorId | "shell" | (string & {})

/** Where the new conversation lands; `scratch` is a new Scratch task. */
export type NewChatDestination = "tab" | "fork" | "scratch"
/** What it starts from. */
export type NewChatContext = "fresh" | "continue"

export interface NewChatChoice {
  readonly pick: EnginePick
  readonly destination: NewChatDestination
  readonly context: NewChatContext
}

export function NewChatDialogView(props: {
  availableVendors: readonly VendorId[]
  defaultVendor: VendorId
  /** Offer a trailing "shell" choice (a plain terminal tab). */
  allowShell?: boolean
  /** Offer the trailing "scratch" destination (a new Scratch task); last so
   *  `tab` still reaches fork in one press. */
  allowScratch?: boolean
  /** Trailing extra choices (plugin panes): `key` is returned, `label` shown. */
  extraChoices?: readonly { key: string; label: string }[]
  /** Preset entries (`ctrl+a c` / `ctrl+a f`) open with a toggle flipped. */
  initialDestination?: NewChatDestination
  initialContext?: NewChatContext
  onSubmit: (choice: NewChatChoice) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const t = useT()
  const padX = useDialogPaddingX()
  const vendors = props.availableVendors.length > 0 ? props.availableVendors : ALL_VENDORS
  const extras = props.extraChoices ?? []
  const [destination, setDestination] = useState<NewChatDestination>(props.initialDestination ?? "tab")
  const [context, setContext] = useState<NewChatContext>(props.initialContext ?? "fresh")
  const destinations: readonly NewChatDestination[] = props.allowScratch ? ["tab", "fork", "scratch"] : ["tab", "fork"]

  // Shell rows exist only for fresh tabs here and Scratch; pane rows only for
  // tabs here. Anything else is an engine conversation by definition.
  const choicesFor = (dest: NewChatDestination, ctx: NewChatContext): readonly EnginePick[] => {
    if (dest === "scratch") return props.allowShell ? [...vendors, "shell"] : vendors
    if (dest === "fork" || ctx === "continue") return vendors
    return [...vendors, ...(props.allowShell ? (["shell"] as const) : []), ...extras.map((e) => e.key)]
  }
  const choices = choicesFor(destination, context)
  const fallback = vendors.includes(props.defaultVendor) ? props.defaultVendor : (vendors[0] ?? DEFAULT_TASK_VENDOR)
  const [pick, setPick] = useState<EnginePick>(fallback)
  const display = (choice: EnginePick): string => extras.find((e) => e.key === choice)?.label ?? choice

  function commit(picked: EnginePick): void {
    props.onSubmit({ pick: picked, destination, context })
    dialog.clear()
  }

  const cycle = (dir: 1 | -1) =>
    setPick((cur) => {
      const i = choices.indexOf(cur)
      return choices[(i + dir + choices.length) % choices.length] ?? cur
    })

  /** Move to a combo: Scratch is fresh-only, and a highlight the new combo
   *  doesn't offer clamps back onto the default engine. */
  const applyCombo = (dest: NewChatDestination, ctx: NewChatContext) => {
    // Scratch + continue: asking for continue FROM scratch leaves for a tab
    // here; arriving AT scratch with continue on resets to fresh.
    const nextDest = dest === "scratch" && ctx === "continue" && destination === "scratch" ? "tab" : dest
    const nextCtx = nextDest === "scratch" ? "fresh" : ctx
    setDestination(nextDest)
    setContext(nextCtx)
    const allowed = choicesFor(nextDest, nextCtx)
    setPick((cur) => (allowed.includes(cur) ? cur : fallback))
  }

  useBindings(() => ({
    bindings: [
      { key: "left", cmd: () => cycle(-1) },
      { key: "right", cmd: () => cycle(1) },
      { key: "h", cmd: () => cycle(-1) },
      { key: "l", cmd: () => cycle(1) },
      {
        key: "tab",
        cmd: () =>
          applyCombo(destinations[(destinations.indexOf(destination) + 1) % destinations.length] ?? "tab", context),
      },
      { key: "ctrl+f", cmd: () => applyCombo(destination, context === "fresh" ? "continue" : "fresh") },
      { key: "return", cmd: () => commit(pick) },
    ],
  }))

  return (
    <box paddingLeft={padX} paddingRight={padX} gap={0}>
      <DialogHeader
        title={t("terminal.tab.newChat.title")}
        onClose={() => {
          // Resolving the promise does not close the dialog; clear it
          // explicitly.
          props.onCancel()
          dialog.clear()
        }}
      />
      <box gap={1} paddingTop={1}>
        <DialogSection label={t("terminal.tab.newChat.engine")} focused={true} hint="←/→">
          <ChipRow choices={choices} selected={pick} display={display} onPick={(v) => commit(v)} />
        </DialogSection>
        <DialogSection label={t("terminal.tab.newChat.destLabel")} focused={false} hint="tab">
          <ChipRow
            choices={destinations}
            selected={destination}
            display={(d) =>
              t(
                d === "tab"
                  ? "terminal.tab.newChat.destTab"
                  : d === "fork"
                    ? "terminal.tab.newChat.destFork"
                    : "terminal.tab.newChat.destScratch",
              )
            }
            onPick={(d) => applyCombo(d, context)}
          />
        </DialogSection>
        <DialogSection label={t("terminal.tab.newChat.ctxLabel")} focused={false} hint="ctrl+f">
          <ChipRow
            choices={["fresh", "continue"] as const}
            selected={context}
            display={(c) => t(c === "fresh" ? "terminal.tab.newChat.ctxFresh" : "terminal.tab.newChat.ctxContinue")}
            onPick={(c) => applyCombo(destination, c)}
          />
        </DialogSection>
        <DialogFooter>{t("terminal.tab.chooseEngineHint")}</DialogFooter>
      </box>
    </box>
  )
}

function show(
  dialog: DialogContext,
  availableVendors: readonly VendorId[],
  defaultVendor: VendorId,
  opts: {
    allowShell?: boolean
    allowScratch?: boolean
    extraChoices?: readonly { key: string; label: string }[]
    initialDestination?: NewChatDestination
    initialContext?: NewChatContext
  } = {},
): Promise<NewChatChoice | undefined> {
  return showDialog<NewChatChoice>(dialog, (resolve) => (
    <NewChatDialogView
      availableVendors={availableVendors}
      defaultVendor={defaultVendor}
      allowShell={opts.allowShell}
      allowScratch={opts.allowScratch}
      extraChoices={opts.extraChoices}
      initialDestination={opts.initialDestination}
      initialContext={opts.initialContext}
      onSubmit={(choice) => resolve(choice)}
      onCancel={() => resolve(undefined)}
    />
  ))
}

export const NewChatDialog = {
  show,
}
