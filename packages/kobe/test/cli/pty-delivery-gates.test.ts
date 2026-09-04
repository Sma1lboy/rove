/**
 * `pty-delivery.ts` delivery gates: A-layer recent-human-write
 * and C-layer composer-empty rejections surface as typed `COMPOSER_BUSY`
 * errors instead of silently concatenating peer text with user input.
 *
 * The last test covers the DEGRADE the protocol promises for
 * `deferredPrompt.file`: "Older daemons reject the verbs; callers then
 * surface COMPOSER_BUSY instead" (kobe-daemon/daemon/protocol.ts). That
 * promise lives in a `catch` with no test on it, so deleting the catch is
 * silent — and the failure it would cause is the bad kind: an accepted
 * prompt that reaches neither the composer nor the queue.
 */

import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/exact-tab-delivery.ts"
import { ApiError } from "../../src/cli/api/types.ts"

function session(key: string, command: string[], alive = true): PtySessionInfo {
  return { key, alive, pid: alive ? 123 : null, command, title: "" }
}

/** A ps snapshot in which pid 123 (the session shell) hosts `child`. */
function psWith(child: string): () => Promise<string> {
  return async () => `123 1 -zsh\n456 123 ${child}\n`
}

function rpcWith(sessions: PtySessionInfo[]) {
  const calls: string[] = []
  const rpc = {
    request: async <T>(name: string): Promise<T> => {
      calls.push(name)
      if (name === "pty.list") return { sessions } as T
      if (name === "pty.peek") return { exists: true, alive: true, data: "" } as T
      return {} as T
    },
  }
  return { rpc, calls }
}

describe("deliverToExactTab A+C gates", () => {
  it("refuses delivery with COMPOSER_BUSY when the user was typing recently", async () => {
    const { rpc } = rpcWith([session("t1::tab-2", ["claude"])])
    const original = rpc.request
    rpc.request = async <T>(name: string): Promise<T> => {
      if (name === "pty.peek") {
        return {
          exists: true,
          alive: true,
          data: Buffer.from("❯", "utf8").toString("base64"),
          sinceValid: false,
          exit: null,
          lastHumanWriteMs: 9_999_999_999_999,
          humanWriteQuietMs: 10_000,
        } as T
      }
      return original(name)
    }
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      vendor: "claude",
      snapshot: psWith("claude"),
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("COMPOSER_BUSY")
    expect((err as ApiError).data?.layer).toBe("recent-human-write")
  })

  it("refuses delivery with COMPOSER_BUSY when the composer has text", async () => {
    const { rpc } = rpcWith([session("t1::tab-2", ["claude"])])
    const original = rpc.request
    rpc.request = async <T>(name: string): Promise<T> => {
      if (name === "pty.peek") {
        return {
          exists: true,
          alive: true,
          data: Buffer.from("❯ hello", "utf8").toString("base64"),
          sinceValid: false,
          exit: null,
        } as T
      }
      return original(name)
    }
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      vendor: "claude",
      snapshot: psWith("claude"),
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("COMPOSER_BUSY")
    expect((err as ApiError).data?.layer).toBe("composer-not-empty")
  })
})

/** A peek whose composer holds text — the C-layer gate rejects it. */
function busyComposerPeek(rpc: ReturnType<typeof rpcWith>["rpc"]) {
  const original = rpc.request
  rpc.request = async <T>(name: string): Promise<T> => {
    if (name === "pty.peek") {
      return {
        exists: true,
        alive: true,
        data: Buffer.from("❯ hello", "utf8").toString("base64"),
        sinceValid: false,
        exit: null,
      } as T
    }
    return original(name)
  }
}

describe("deferral sink against an older daemon", () => {
  it("defers into the daemon queue when the verb exists", async () => {
    // The baseline the degrade is measured against: with a working sink the
    // send is an accepted-and-queued SUCCESS, not an error.
    const { rpc } = rpcWith([session("t1::tab-2", ["claude"])])
    busyComposerPeek(rpc)
    const result = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      vendor: "claude",
      snapshot: psWith("claude"),
      defer: { defer: async () => ({ kind: "filed", id: "deferred-1" }) },
    })
    expect(result.deferred).toEqual({ id: "deferred-1", layer: "composer-not-empty" })
    expect(result.delivered).toBe(false)
  })

  it("falls back to COMPOSER_BUSY when the daemon rejects deferredPrompt.file", async () => {
    // An older daemon answers the file RPC with `unknown daemon request:`.
    // The prompt must come back as the typed retryable error — the one
    // outcome that must NEVER happen here is a reported success, because the
    // caller would then not retry a message no queue is holding.
    const { rpc } = rpcWith([session("t1::tab-2", ["claude"])])
    busyComposerPeek(rpc)
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      vendor: "claude",
      snapshot: psWith("claude"),
      defer: {
        defer: async () => {
          throw new Error("unknown daemon request: deferredPrompt.file")
        },
      },
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("COMPOSER_BUSY")
    expect((err as ApiError).data?.layer).toBe("composer-not-empty")
    // The recovery argv is the original send, so a caller can retry verbatim.
    expect((err as ApiError).data?.nextCommandArgs).toEqual(["api", "send", "--task-id", "t1", "--prompt", "go"])
  })

  it("fails explicitly when the tab already has a deferred prompt", async () => {
    const { rpc } = rpcWith([session("t1::tab-2", ["claude"])])
    busyComposerPeek(rpc)
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "new prompt", {
      vendor: "claude",
      snapshot: psWith("claude"),
      defer: {
        defer: async () => ({ kind: "occupied", id: "deferred-1" }),
      },
    }).then(
      () => null,
      (e) => e,
    )

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("DEFERRED_PROMPT_PENDING")
    expect((err as ApiError).data).toMatchObject({ existingId: "deferred-1", taskId: "t1", tabId: "tab-2" })
  })
})
