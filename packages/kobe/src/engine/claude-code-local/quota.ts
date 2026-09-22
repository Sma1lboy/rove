/**
 * Claude subscription-quota probe: when does the exhausted window reset? Lets
 * the quota-resume runner schedule a continue prompt after a `rate_limit` hook.
 *
 * Mirrors the CLI's `/usage` contract (OAuth beta header; unknown clients are
 * rejected). Token from macOS Keychain, then `~/.claude/.credentials.json` (or
 * `$CLAUDE_CONFIG_DIR`'s). Tokens are only READ: racing the CLI's refresh-token
 * rotation can log the user out, so an expired token just means no probe.
 */

import { homedir, userInfo } from "node:os"
import path from "node:path"
import { spawnCapture } from "../../lib/poll-scheduling.ts"
import type { EngineQuotaUsage, EngineQuotaWindow } from "../../types/engine.ts"
import { readTextFileBounded } from "../file-bounds"
import { vendorConfigHome } from "../vendor-home.ts"

const OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const OAUTH_BETA_HEADER = "oauth-2025-04-20"
const OAUTH_USER_AGENT = "claude-cli/2.1.198 (external, cli)"
const USAGE_TIMEOUT_MS = 10_000
const KEYCHAIN_SERVICE = "Claude Code-credentials"

/** One row of the usage response's `limits[]` array (stable across codenames). */
interface UsageLimit {
  readonly kind?: string
  readonly percent?: number
  readonly resets_at?: number | string | null
  readonly scope?: { readonly model?: { readonly display_name?: string | null } | null } | null
}

export interface ClaudeUsagePayload {
  readonly limits?: readonly UsageLimit[]
  readonly five_hour?: { readonly utilization?: number; readonly resets_at?: number | string | null } | null
  readonly seven_day?: { readonly utilization?: number; readonly resets_at?: number | string | null } | null
}

/** Parse `resets_at` in any form the API emits: epoch seconds, epoch ms, ISO. */
export function parseResetsAtMs(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const numeric = typeof value === "number" ? value : /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null
  if (numeric != null) {
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    return numeric < 1e12 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(String(value))
  return Number.isNaN(parsed) ? null : parsed
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)))

/** Display label for a raw window kind ("5h" / "7d" / a scoped model name). */
function windowLabel(kind: string, scopeModel: string | null | undefined): string {
  if (kind === "weekly_scoped" && scopeModel) return scopeModel
  return kind.startsWith("weekly") || kind.startsWith("seven_day") ? "7d" : "5h"
}

/** Usage response → neutral windows. Prefers `limits[]` (stable shape; top-level
 *  codenames churn), falling back to legacy `five_hour`/`seven_day`. */
export function usageFromClaudePayload(payload: ClaudeUsagePayload, capturedAt: number): EngineQuotaUsage {
  const windows: EngineQuotaWindow[] = []
  if (payload.limits?.length) {
    for (const limit of payload.limits) {
      if (typeof limit.kind !== "string" || typeof limit.percent !== "number") continue
      windows.push({
        kind: limit.kind,
        label: windowLabel(limit.kind, limit.scope?.model?.display_name),
        percent: clampPercent(limit.percent),
        resetsAt: parseResetsAtMs(limit.resets_at),
      })
    }
  } else {
    if (typeof payload.five_hour?.utilization === "number") {
      windows.push({
        kind: "session",
        label: "5h",
        percent: clampPercent(payload.five_hour.utilization),
        resetsAt: parseResetsAtMs(payload.five_hour.resets_at),
      })
    }
    if (typeof payload.seven_day?.utilization === "number") {
      windows.push({
        kind: "weekly_all",
        label: "7d",
        percent: clampPercent(payload.seven_day.utilization),
        resetsAt: parseResetsAtMs(payload.seven_day.resets_at),
      })
    }
  }
  return { windows, capturedAt }
}

interface OAuthCredentials {
  readonly accessToken: string
  readonly expiresAt?: number
}

function parseCredentials(raw: string): OAuthCredentials | null {
  try {
    const oauth = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } })?.claudeAiOauth
    if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken) return null
    return {
      accessToken: oauth.accessToken,
      ...(typeof oauth.expiresAt === "number" && Number.isFinite(oauth.expiresAt)
        ? { expiresAt: oauth.expiresAt }
        : {}),
    }
  } catch {
    return null
  }
}

const isFresh = (c: OAuthCredentials): boolean => c.expiresAt === undefined || c.expiresAt > Date.now()

async function readFileCredentials(dir: string): Promise<OAuthCredentials | null> {
  try {
    return parseCredentials(await readTextFileBounded(path.join(dir, ".credentials.json")))
  } catch {
    return null
  }
}

async function readKeychainCredentials(): Promise<OAuthCredentials | null> {
  if (process.platform !== "darwin") return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    // `-a` is load-bearing: one service can hold SEVERAL items (a stale
    // `acct=unknown` row beside today's login), and service-only returns
    // whichever scans first. The CLI pairs `-a $USER` with `-s`
    // (refs/claude-code `macOsKeychainStorage.ts`).
    const result = await spawnCapture(
      "security",
      ["find-generic-password", "-a", userInfo().username, "-w", "-s", KEYCHAIN_SERVICE],
      {
        cwd: homedir(),
        signal: controller.signal,
      },
    )
    return result.status === 0 ? parseCredentials(result.stdout.trim()) : null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * The freshest CLI login this process would resolve. An isolated
 * `CLAUDE_CONFIG_DIR` profile ignores the default Keychain/`~/.claude` login
 * (the CLI does the same), so only that profile's file is consulted.
 */
async function readAccessToken(): Promise<string | null> {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (configDir) {
    const fromFile = await readFileCredentials(configDir)
    return fromFile && isFresh(fromFile) ? fromFile.accessToken : null
  }
  const candidates = [await readKeychainCredentials(), await readFileCredentials(vendorConfigHome("claude"))]
  return candidates.find((c): c is OAuthCredentials => c != null && isFresh(c))?.accessToken ?? null
}

/** Quota windows, or null when unfetchable. Never throws. The endpoint is
 *  itself rate-limited: never call on a hot path (the daemon's usage cache
 *  enforces min-interval + backoff). */
export async function fetchClaudeQuotaUsage(now: () => number = Date.now): Promise<EngineQuotaUsage | null> {
  const token = await readAccessToken().catch(() => null)
  if (!token) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS)
  try {
    const response = await fetch(OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": OAUTH_USER_AGENT,
        "anthropic-beta": OAUTH_BETA_HEADER,
      },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return usageFromClaudePayload((await response.json()) as ClaudeUsagePayload, now())
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
