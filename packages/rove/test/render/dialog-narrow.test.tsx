/** @jsxImportSource @opentui/react */
/**
 * Narrow dialog clamp: the card width clamps to terminal−2, and the new-chat footer hint wraps to a second line instead
 * of clipping. Content itself is unchanged.
 */

import { expect, test } from "bun:test"
import { NewChatDialogView } from "../../src/tui-react/component/new-chat-dialog"
import { renderComponent } from "./harness"

test("new-chat dialog at 46 cols keeps its full footer hint across wrapped lines", async () => {
  const { frame } = await renderComponent(
    <NewChatDialogView
      availableVendors={["claude", "codex"]}
      defaultVendor="claude"
      allowShell={true}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { width: 46, height: 24, providers: { dialog: true } },
  )
  const out = await frame()
  // The hint's head AND tail both render — wrapped, not clipped.
  expect(out).toContain("←/→ or h/l choose")
  expect(out.replace(/\n/g, " ")).toMatch(/esc\s+cancel|esc cancel/)
})
