/**
 * `quota.list`: every "how much is left" meter the side panel's Usage tab draws, from a small set of
 * sources that each answer in the same shape. A source that has nothing to say (no key, no reading
 * yet) is left out rather than drawn as zero.
 *
 * E2B has no balance API: its spend is ESTIMATED from the sandboxes this bridge has seen running
 * (`GET /sandboxes` every minute while sampling, CPU and memory seconds at E2B's list price), kept in
 * state.json `quota.e2b` so it survives restarts. Sandboxes that ran while no bridge was sampling are
 * not counted, and the meter says so.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { engineDisplayName } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import { loadStateFile, updateStateFile } from "@sma1lboy/rove/src/state/store.ts"
import { type UsageStore, usageStore } from "../usage-store.ts"
import { optText } from "./args.ts"
import type { OpTable } from "./types.ts"

/** One slice of a meter (a row under the bar, and its segment in the bar when `share` is set). */
export interface QuotaPart {
  /** Engine-owned text (a quota window's name); Rove's own rows send `labelKey` instead. */
  readonly label?: string
  /** `quota.part.<key>` in the web's catalog. */
  readonly labelKey?: string
  /** Shown as is: "191.6k", "$1.20", "82%". */
  readonly value: string
  /** 0..100 of the meter's limit; omitted for an informational row with no segment. */
  readonly share?: number
  /** Epoch ms this part resets at, when it has its own reset. */
  readonly resetsAt?: number | null
}

export interface QuotaMeter {
  readonly id: string
  readonly source: "context" | "engine" | "e2b"
  /** Engine-owned name; Rove's own meters send `titleKey` (`quota.title.<key>`). */
  readonly title?: string
  readonly titleKey?: string
  /** 0..100. */
  readonly percent: number
  /** "255k / 1M", "$3.20 / $100". */
  readonly amount: string
  readonly resetsAt: number | null
  /** Epoch ms a prepaid credit lapses, unspent or not. */
  readonly expiresAt?: number
  readonly parts: readonly QuotaPart[]
  /** Where the number comes from when it is not exact: `quota.note.<key>`, with `since` (epoch ms) for `estimated`. */
  readonly note?: { readonly key: "estimated" | "approximate"; readonly since?: number; readonly error?: string }
}

/** E2B list price (Nov 2026): per vCPU-second and per GiB-second of memory. */
export const E2B_PRICE = { cpuSecond: 0.000014, gibSecond: 0.0000045 } as const
export const E2B_FREE_CREDIT = 100
/** This account's credit expiry, as the E2B console's Billing page shows it; no API reports it. Noon UTC so every zone reads Jan 1. */
export const E2B_CREDIT_EXPIRES = Date.UTC(2027, 0, 1, 12)
export const E2B_MAX_CONCURRENT = 20
const E2B_STATE_KEY = "quota.e2b"
const SAMPLE_MS = 60_000

export interface E2bSandbox {
  readonly sandboxID: string
  readonly cpuCount: number
  readonly memoryMB: number
  readonly startedAt: string
}

/** Per sandbox: the seconds already counted, so a sample only adds the time since the last one. */
export interface E2bLedger {
  readonly cpuSeconds: number
  readonly gibSeconds: number
  readonly since: number
  readonly seen: Readonly<Record<string, { readonly counted: number; readonly cpu: number; readonly gib: number }>>
}

const EMPTY_LEDGER = (now: number): E2bLedger => ({ cpuSeconds: 0, gibSeconds: 0, since: now, seen: {} })

/** Folds one `GET /sandboxes` answer into the ledger: each live sandbox's runtime so far, minus what was already counted. */
export function foldSample(ledger: E2bLedger, running: readonly E2bSandbox[], now: number): E2bLedger {
  let cpuSeconds = ledger.cpuSeconds
  let gibSeconds = ledger.gibSeconds
  const seen: Record<string, { counted: number; cpu: number; gib: number }> = {}
  for (const box of running) {
    const started = Date.parse(box.startedAt)
    if (!Number.isFinite(started)) continue
    const total = Math.max(0, (now - started) / 1000)
    const before = ledger.seen[box.sandboxID]?.counted ?? 0
    const add = Math.max(0, total - before)
    const gib = box.memoryMB / 1024
    cpuSeconds += add * box.cpuCount
    gibSeconds += add * gib
    seen[box.sandboxID] = { counted: Math.max(total, before), cpu: box.cpuCount, gib }
  }
  return { cpuSeconds, gibSeconds, since: ledger.since, seen }
}

export function e2bMeter(ledger: E2bLedger, running: number | null): QuotaMeter {
  const cpu = ledger.cpuSeconds * E2B_PRICE.cpuSecond
  const mem = ledger.gibSeconds * E2B_PRICE.gibSecond
  const spent = cpu + mem
  const share = (dollars: number) => Math.min(100, (dollars / E2B_FREE_CREDIT) * 100)
  return {
    id: "e2b",
    source: "e2b",
    titleKey: "e2b",
    percent: share(spent),
    amount: `${dollars(spent)} / ${dollars(E2B_FREE_CREDIT)}`,
    resetsAt: null,
    expiresAt: E2B_CREDIT_EXPIRES,
    parts: [
      { labelKey: "cpu", value: dollars(cpu), share: share(cpu) },
      { labelKey: "memory", value: dollars(mem), share: share(mem) },
      { labelKey: "running", value: running === null ? "?" : `${running} / ${E2B_MAX_CONCURRENT}` },
      { labelKey: "left", value: dollars(Math.max(0, E2B_FREE_CREDIT - spent)) },
    ],
    note: { key: "estimated", since: ledger.since },
  }
}

function dollars(n: number): string {
  return `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`
}

/** `E2B_API_KEY` from the bridge's environment, else from `~/.env` (only that one line is read). */
export function e2bKey(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string | null {
  const direct = env.E2B_API_KEY?.trim()
  if (direct) return direct
  try {
    const line = readFileSync(join(home, ".env"), "utf8")
      .split("\n")
      .find((l) => /^\s*(export\s+)?E2B_API_KEY\s*=/.test(l))
    const value = line
      ?.split("=")
      .slice(1)
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "")
    return value || null
  } catch {
    return null
  }
}

export interface QuotaDeps {
  readonly usage: UsageStore
  readonly engineName: (id: string) => string
  readonly e2bKey: () => string | null
  readonly fetchSandboxes: (key: string) => Promise<readonly E2bSandbox[]>
  readonly loadLedger: () => E2bLedger | null
  readonly saveLedger: (ledger: E2bLedger) => void
  readonly now: () => number
  readonly schedule: (run: () => void, ms: number) => void
}

async function fetchSandboxes(key: string): Promise<readonly E2bSandbox[]> {
  const res = await fetch("https://api.e2b.dev/sandboxes", {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`E2B ${res.status}`)
  const body = (await res.json()) as unknown
  return Array.isArray(body) ? (body as E2bSandbox[]) : []
}

const realDeps: QuotaDeps = {
  usage: usageStore,
  engineName: engineDisplayName,
  e2bKey: () => e2bKey(),
  fetchSandboxes,
  loadLedger: () => {
    const raw = loadStateFile()[E2B_STATE_KEY]
    return raw && typeof raw === "object" && typeof (raw as E2bLedger).cpuSeconds === "number"
      ? (raw as E2bLedger)
      : null
  },
  saveLedger: (ledger) => {
    updateStateFile((state) => {
      state[E2B_STATE_KEY] = ledger
      return true
    })
  },
  now: Date.now,
  schedule: (run, ms) => {
    setTimeout(run, ms).unref?.()
  },
}

function engineMeters(deps: QuotaDeps): QuotaMeter[] {
  const rows = deps.usage.get() ?? []
  return rows
    .filter((row) => row.windows.length > 0)
    .map((row) => {
      const top = row.windows.reduce((a, b) => (b.percent > a.percent ? b : a))
      return {
        id: `engine:${row.vendor}`,
        source: "engine" as const,
        title: deps.engineName(row.vendor),
        percent: top.percent,
        amount: top.label,
        resetsAt: top.resetsAt,
        parts: row.windows.map((w) => ({ label: w.label, value: `${w.percent}%`, resetsAt: w.resetsAt })),
      }
    })
}

function contextMeter(deps: QuotaDeps, session: string | undefined): QuotaMeter | null {
  if (!session) return null
  const ctx = deps.usage.context(session)
  if (!ctx || !ctx.contextWindowTokens) return null
  const used = ctx.contextTokens
  const window = ctx.contextWindowTokens
  const percent = Math.min(100, (used / window) * 100)
  const parts: QuotaPart[] = [{ labelKey: "used", value: tokens(used), share: percent }]
  parts.push({ labelKey: "free", value: tokens(Math.max(0, window - used)) })
  if (ctx.inputTokens !== undefined) parts.push({ labelKey: "input", value: tokens(ctx.inputTokens) })
  if (ctx.outputTokens !== undefined) parts.push({ labelKey: "output", value: tokens(ctx.outputTokens) })
  return {
    id: "context",
    source: "context",
    titleKey: "context",
    percent,
    amount: `${tokens(used)} / ${tokens(window)}`,
    resetsAt: null,
    parts,
    ...(ctx.approximate ? { note: { key: "approximate" as const } } : {}),
  }
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(n)
}

export function createQuotaOps(deps: QuotaDeps): OpTable {
  let ledger: E2bLedger | null = null
  let running: number | null = null
  let sampling = false
  let lastError: string | null = null

  async function sample(key: string): Promise<void> {
    try {
      const boxes = await deps.fetchSandboxes(key)
      ledger = foldSample(ledger ?? deps.loadLedger() ?? EMPTY_LEDGER(deps.now()), boxes, deps.now())
      running = boxes.length
      lastError = null
      deps.saveLedger(ledger)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  function startSampling(key: string): void {
    if (sampling) return
    sampling = true
    const tick = () => {
      void sample(key).finally(() => deps.schedule(tick, SAMPLE_MS))
    }
    deps.schedule(tick, SAMPLE_MS)
  }

  return {
    "quota.list": {
      kind: "read",
      destructive: false,
      wraps:
        "usage.get's engine quota and session context (bridge usage store) plus E2B GET /sandboxes, whose spend is estimated from sampled runtimes (state.json quota.e2b)",
      async run(args) {
        const meters: QuotaMeter[] = []
        const taskId = optText(args, "taskId", 64)
        const tabId = optText(args, "tabId", 32)
        const ctx = contextMeter(deps, taskId && tabId ? `${taskId}::${tabId}` : undefined)
        if (ctx) meters.push(ctx)
        meters.push(...engineMeters(deps))
        const key = deps.e2bKey()
        if (key) {
          await sample(key)
          startSampling(key)
          const meter = e2bMeter(ledger ?? deps.loadLedger() ?? EMPTY_LEDGER(deps.now()), running)
          meters.push(
            lastError ? { ...meter, note: { key: "estimated", since: meter.note?.since, error: lastError } } : meter,
          )
        }
        return { meters, engineReported: deps.usage.get() !== null }
      },
    },
  }
}

export const quotaOps: OpTable = createQuotaOps(realDeps)
