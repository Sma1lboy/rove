/**
 * `pty-delivery.ts` delivery gates (issue #78): A-layer recent-human-write
 * and C-layer composer-empty rejections surface as typed `COMPOSER_BUSY`
 * errors instead of silently concatenating peer text with user input.
 */

import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/pty-delivery.ts"
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
