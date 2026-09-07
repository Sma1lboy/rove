import type { AttentionInboxItem } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { describe, expect, it } from "vitest"
import { deferredPromptSubtitle } from "../../src/tui-react/workspace/inbox-item-view.ts"

/**
 * A queued-message card has to answer three questions before someone presses
 * `d`: who sent it, what held it, how long it survives. The card that lost a
 * dispatcher's instruction answered none of them — it said "message queued"
 * and a countdown.
 */
const NOW = 1_000_000

function t(key: string, params?: Record<string, string>): string {
  const text: Record<string, string> = {
    "workspace.inbox.from": `from ${params?.sender ?? ""}`,
    "workspace.inbox.layer.keystroke": "you were typing",
    "workspace.inbox.layer.screen": "composer had text",
    "workspace.inbox.expiresIn": `expires in ${params?.in ?? ""}`,
    "workspace.inbox.expiringNow": "expiring now",
    "workspace.inbox.expiredNote": "never delivered",
  }
  return text[key] ?? key
}

function deferred(detail: Partial<NonNullable<AttentionInboxItem["detail"]>["deferredPrompt"]>) {
  return {
    state: "prompt_deferred" as const,
    detail: { deferredPrompt: { id: "d1", layer: "composer-not-empty" as const, ...detail } },
  }
}

describe("deferred inbox card context line", () => {
  it("names the sender, the blocking layer, and the deadline", () => {
    const line = deferredPromptSubtitle(
      deferred({ sender: "kobe", expiresAt: NOW + 3_600_000 }),
      "Auth attempt",
      NOW,
      t,
    )
    expect(line).toBe("from kobe · composer had text · expires in 1h")
  })

  it("distinguishes the two layers, so a vendor-layout hold reads differently from a human typing", () => {
    const screen = deferredPromptSubtitle(deferred({ sender: "kobe" }), "Task", NOW, t)
    const keystroke = deferredPromptSubtitle(deferred({ sender: "kobe", layer: "recent-human-write" }), "Task", NOW, t)
    expect(screen).toContain("composer had text")
    expect(keystroke).toContain("you were typing")
    expect(screen).not.toBe(keystroke)
  })

  it("falls back to the task title when the episode predates the sender field", () => {
    // An episode written by an older daemon has no `sender`. Showing the task
    // title beats printing "from undefined".
    expect(deferredPromptSubtitle(deferred({ expiresAt: NOW + 60_000 }), "Auth attempt", NOW, t)).toBe(
      "Auth attempt · composer had text · expires in 1m",
    )
  })

  it("keeps the epitaph on an expired message", () => {
    const line = deferredPromptSubtitle(
      {
        state: "prompt_expired",
        detail: { deferredPrompt: { id: "d1", layer: "recent-human-write", sender: "kobe" } },
      },
      "Task",
      NOW,
      t,
    )
    expect(line).toBe("from kobe · you were typing · never delivered")
  })
})
