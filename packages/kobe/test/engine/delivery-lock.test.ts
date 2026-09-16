import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { deliveryLockPath, withDeliveryLock } from "../../src/engine/delivery-lock.ts"
import { type HostedSessionRpc, writeHostedPrompt } from "../../src/engine/hosted-session.ts"
import { acquire } from "../../src/orchestrator/index/lockfile.ts"

/** Record every `pty.write` in arrival order — the only thing that decides
 *  whether the engine sees one composer or two. */
function recordingRpc(log: string[]): HostedSessionRpc {
  return {
    request: async <T>(name: string, payload?: unknown): Promise<T> => {
      if (name === "pty.write") log.push((payload as { data?: string })?.data ?? "")
      return {} as T
    },
  }
}

/** A delivery is `\x1b[200~…\x1b[201~` then a submit key; the pair must be
 *  adjacent. Anything between them belongs to another sender and lands inside
 *  this one's composer. */
function interleaved(log: readonly string[]): boolean {
  return log.some((data, i) => data.startsWith("\x1b[200~") && !(log[i + 1] ?? "").endsWith("\r"))
}

describe("concurrent delivery into one session", () => {
  it("does not interleave two senders' paste/submit pairs on the same key", async () => {
    // Two `rove api send` processes reporting into one coordinator tab at the
    // end of a fan-out round. Unserialised, A's paste, B's paste, A's CR
    // submits A+B as a single turn and B's CR hits an empty composer — the
    // "one user turn, two [ROVE PEER] headers" shape this lock exists to stop.
    const log: string[] = []
    const rpc = recordingRpc(log)
    await Promise.all([
      writeHostedPrompt(rpc, "task::tab-1", "report A", { ready: true }),
      writeHostedPrompt(rpc, "task::tab-1", "report B", { ready: true }),
    ])
    expect(log).toHaveLength(4)
    expect(interleaved(log)).toBe(false)
    // Both reports arrived whole, in some order, each followed by its own key.
    expect(log.filter((d) => d.startsWith("\x1b[200~")).sort()).toEqual([
      "\x1b[200~report A\x1b[201~",
      "\x1b[200~report B\x1b[201~",
    ])
  })

  it("locks per key, so a second tab's delivery is not held behind the first", async () => {
    const log: string[] = []
    const rpc = recordingRpc(log)
    await Promise.all([
      writeHostedPrompt(rpc, "task::tab-1", "to tab one", { ready: true }),
      writeHostedPrompt(rpc, "task::tab-2", "to tab two", { ready: true }),
    ])
    // Different keys share no lock, so these MAY interleave — what must hold is
    // that each tab received its own complete pair.
    expect(log).toHaveLength(4)
    expect(log.filter((d) => d.endsWith("\r"))).toHaveLength(2)
  })

  it("delivers anyway when the lock never comes free", async () => {
    // Best effort, never a refusal: a wedged holder must cost a merge at worst,
    // never a report that silently never reached its coordinator.
    const lockDir = mkdtempSync(path.join(tmpdir(), "rove-deliver-lock-"))
    const held = deliveryLockPath("task::tab-1", lockDir)
    await acquire(held) // held by THIS pid, so the liveness probe keeps it
    let ran = false
    await withDeliveryLock(
      "task::tab-1",
      async () => {
        ran = true
      },
      { lockDir, timeoutMs: 60 },
    )
    expect(ran).toBe(true)
  })
})
