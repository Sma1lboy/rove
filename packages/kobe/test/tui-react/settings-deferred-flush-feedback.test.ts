import { describe, expect, it, vi } from "vitest"
import { flushDeferredPromptsWithFeedback } from "../../src/tui-react/component/settings-dialog/deferred-flush-feedback.ts"
import type { DialogContext } from "../../src/tui-react/ui/dialog.tsx"

const mocks = vi.hoisted(() => ({ show: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../../src/tui-react/ui/dialog-confirm.tsx", () => ({ DialogConfirm: { show: mocks.show } }))

describe("deferred queue settings feedback", () => {
  it("shows an on-screen error when an older daemon lacks the flush verb", async () => {
    const remote = {
      flushDeferredPrompts: vi.fn().mockRejectedValue(new Error("unknown handler: deferredPrompt.flush")),
    }

    await flushDeferredPromptsWithFeedback(remote as never, {} as DialogContext)

    expect(mocks.show).toHaveBeenCalledWith(
      expect.anything(),
      "Deferred prompts were not flushed",
      expect.stringContaining("unknown handler: deferredPrompt.flush"),
      "cancel",
    )
  })
})
