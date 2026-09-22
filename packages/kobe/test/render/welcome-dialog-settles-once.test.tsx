import { expect, test } from "bun:test"
import type { ReactElement } from "react"
import { type OnboardingChoices, WelcomeDialog } from "../../src/tui-react/onboarding/host"
import type { DialogContext } from "../../src/tui-react/ui/dialog"

// The real stack runs every entry's onClose on clear(); an accepted answer used
// to be followed by a "declined everything" one that overwrote it.
function fakeDialog() {
  let entry: { thunk: () => ReactElement; onClose?: () => void } | null = null
  const dialog = {
    replace: (thunk: () => ReactElement, onClose?: () => void) => {
      entry = { thunk, onClose }
    },
    clear: () => {
      const e = entry
      entry = null
      e?.onClose?.()
    },
    setSize: () => {},
  } as unknown as DialogContext
  return { dialog, view: () => entry?.thunk() as ReactElement<{ onDone: (c: OnboardingChoices) => void }> }
}

test("accepting in the welcome dialog settles once, with the accepted answer", () => {
  const { dialog, view } = fakeDialog()
  const calls: OnboardingChoices[] = []
  WelcomeDialog.show(dialog, { shell: "zsh", onDone: (c) => calls.push(c) })
  view().props.onDone({ completions: true, skill: true })
  expect(calls).toEqual([{ completions: true, skill: true }])
})

test("closing without answering settles as declined", () => {
  const { dialog } = fakeDialog()
  const calls: OnboardingChoices[] = []
  WelcomeDialog.show(dialog, { shell: "zsh", onDone: (c) => calls.push(c) })
  dialog.clear()
  expect(calls).toEqual([{ completions: false, skill: false }])
})
