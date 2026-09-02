import { mkdtempSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AttentionInboxStore } from "@sma1lboy/kobe-daemon/daemon/attention-inbox"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { describe, expect, it } from "vitest"

/**
 * A killed engine must leave a durable Inbox episode.
 *
 * Every OTHER episode is something the engine reported about ITSELF, so a
 * killed engine (no Stop, no SessionEnd, no hook at all) produces none, and
 * the one surface whose job is "what needs me" stays silent through every
 * simultaneous death. The badge is transient; this is the half that is still
 * there after the tab scrolls away.
 */
describe("inbox death episode", () => {
  it("persists a dead episode carrying the exit detail", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "inbox-")), "attention-inbox.json")
    const store = new AttentionInboxStore(path, new DaemonEventBus())
    await store.init()
    await store.recordEngineDeath("t1", "tab-1", { exit: { code: 143, lastLine: "403 limit" } }, 1000)
    const parsed = JSON.parse(await readFile(path, "utf8"))
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0].state).toBe("dead")
    expect(parsed.items[0].detail.exit.code).toBe(143)
    expect(store.snapshot()[0]?.state).toBe("dead")
  })
})
