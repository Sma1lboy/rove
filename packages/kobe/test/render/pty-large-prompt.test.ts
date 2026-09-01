/**
 * The 8.6KB-prompt truncation bug: `rove api add/send` reported
 * `delivered: true` while the engine received nothing (9 tasks dispatched
 * empty in one afternoon).
 *
 * ROOT CAUSE, measured here rather than argued: a cold engine's pty is in
 * CANONICAL mode until the engine calls `stty raw` and starts reading. The
 * tty's canonical input buffer is `MAX_INPUT` — 1024 bytes on macOS — and a
 * write past it is DISCARDED, not blocked. `pty.write` returns void, so the
 * loss was invisible at every layer above it.
 *
 * The failure signature is a TRUNCATED PREFIX, not a total drop, which is
 * why the control test below asserts the received bytes are a prefix of the
 * prompt: 1024 of 8600 arriving is kernel-queue overflow, whereas 0 would
 * have been a different bug entirely.
 *
 * These run against a REAL Bun PTY child, not a mock — a mocked pty has no
 * kernel input queue and cannot reproduce this at all. The child is `sh`
 * scripted to behave like an engine (stay canonical, then `stty raw`,
 * announce bracketed paste, drain stdin to a file) so the test owns timing
 * a real engine only offers by luck. Real-engine measurements behind the
 * numbers: claude announces DECSET 2004 at ~258ms, codex ~321ms, kimi
 * ~1953ms — kimi lands AFTER the old hardcoded 1500ms settle, which is
 * exactly why kimi was the vendor that lost prompts.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PtyHost } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { type HostedSessionRpc, awaitPasteReady, writeHostedPrompt } from "../../src/engine/hosted-session.ts"

const hosts: PtyHost[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.killAll()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-large-prompt-"))
  dirs.push(dir)
  return dir
}

/** Delivery's view of the host: peek + write only, like production. */
function deliveryRpc(host: PtyHost): HostedSessionRpc {
  return {
    request: async <T>(name: string, payload?: unknown): Promise<T> => {
      const p = payload as { key: string; data?: string; sinceOffset?: number }
      if (name === "pty.peek") return host.peek(p.key, p.sinceOffset) as T
      if (name === "pty.write") {
        host.write(p.key, p.data ?? "")
        return {} as T
      }
      throw new Error(`delivery used forbidden rpc: ${name}`)
    },
  }
}

/**
 * A stand-in engine: stays canonical for `coldMs`, then goes raw, announces
 * bracketed paste, and drains stdin into `sink`. That canonical head is the
 * window that ate the prompts.
 */
function spawnFakeEngine(host: PtyHost, key: string, sink: string, coldMs: number): void {
  host.open(
    key,
    {
      cwd: "/tmp",
      command: ["/bin/sh", "-c", `sleep ${coldMs / 1000}; stty raw -echo; printf '\\033[?2004h'; cat > ${sink}`],
      cols: 120,
      rows: 30,
    },
    {},
    () => {},
  )
}

/** Bytes the child received, minus the paste wrapper and the submit CR. */
function received(sink: string): string {
  const raw = readFileSync(sink, "utf8")
  return raw.replaceAll("\x1b[200~", "").replaceAll("\x1b[201~", "").replace(/\r$/, "")
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 8.6KB — the incident's size, with a unique tail so a truncated prefix is
 *  distinguishable from a whole delivery. */
const BIG_PROMPT = `analyze this repo. ${"padding words to reach the incident size. ".repeat(210)}TAIL-MARKER-7Q`

describe("large prompt delivery into a cold engine", () => {
  test("the prompt arrives WHOLE, tail included", async () => {
    expect(Buffer.byteLength(BIG_PROMPT)).toBeGreaterThan(8_000)
    const host = new PtyHost({})
    hosts.push(host)
    const sink = join(scratch(), "got.txt")
    // Cold for 1.6s: past the old hardcoded 1500ms settle, like kimi.
    spawnFakeEngine(host, "t1::tab-1", sink, 1_600)

    const bytes = await writeHostedPrompt(deliveryRpc(host), "t1::tab-1", BIG_PROMPT)
    await settle(1_500)

    const got = received(sink)
    expect(got.length).toBe(BIG_PROMPT.length)
    expect(got).toBe(BIG_PROMPT)
    expect(got.endsWith("TAIL-MARKER-7Q")).toBe(true)
    expect(bytes).toBeGreaterThan(8_000)
  }, 30_000)

  test("readiness is observed, not slept for: it waits past a 1500ms-style settle", async () => {
    const host = new PtyHost({})
    hosts.push(host)
    const sink = join(scratch(), "ready.txt")
    spawnFakeEngine(host, "t2::tab-1", sink, 1_800)

    const start = Date.now()
    const ready = await awaitPasteReady(deliveryRpc(host), "t2::tab-1", { timeoutMs: 10_000 })
    const waited = Date.now() - start

    expect(ready).toBe(true)
    // The old code wrote at ~1500ms and lost the prompt; this must not.
    expect(waited).toBeGreaterThan(1_500)
  }, 30_000)

  test("writing into the canonical window truncates at the tty buffer (the bug)", async () => {
    const host = new PtyHost({})
    hosts.push(host)
    const sink = join(scratch(), "lost.txt")
    spawnFakeEngine(host, "t3::tab-1", sink, 1_600)

    // Reproduce the OLD behaviour exactly: write immediately, no readiness
    // wait. The control that proves the fix is what does the work.
    await settle(200)
    host.write("t3::tab-1", `\x1b[200~${BIG_PROMPT}\x1b[201~`)
    await settle(2_500)

    const got = received(sink)
    expect(got.length).toBeLessThan(BIG_PROMPT.length)
    expect(got.endsWith("TAIL-MARKER-7Q")).toBe(false)
    // A truncated PREFIX, not a total drop — the kernel-queue signature.
    expect(got.length).toBeGreaterThan(0)
    expect(BIG_PROMPT.startsWith(got.slice(0, 200))).toBe(true)
  }, 30_000)
})
