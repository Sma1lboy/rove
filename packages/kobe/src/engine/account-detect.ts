/**
 * Read-only binary + account detection for the Settings "Accounts" section
 * and the new-task engine selector. Never writes.
 *
 *   - **claude-code**: `$CLAUDE_CONFIG_DIR/.claude.json` (default
 *     `~/.claude.json`); `oauthAccount` carries `emailAddress`,
 *     `organizationName`, `displayName`, `billingType` (producer:
 *     `refs/claude-code/src/services/oauth/client.ts`).
 *   - **codex**: `$CODEX_HOME/auth.json`, two exclusive shapes:
 *       - ChatGPT login → `tokens.id_token` JWT with `email` and
 *         `https://api.openai.com/auth.chatgpt_plan_type`.
 *       - API-key login → `OPENAI_API_KEY` is a non-empty string.
 *
 * No subprocess (`claude /status`, `codex auth status` are slow and print
 * the same on-disk state). Anything other than logged-in / not-logged-in
 * (unreadable file, bad JSON, malformed JWT) is `accountError`, never
 * reported as "not logged in".
 */

import { homedir } from "node:os"
import { errorMessage } from "@/lib/error-message"
import { getCustomEngineIds, getDisabledEngineIds } from "@/state/repos"
import type { VendorId } from "@/types/vendor"
import { BinaryNotFoundError } from "./binary-discovery"
import { findBobBinary } from "./bob-local/binary"
import { findClaudeBinary } from "./claude-code-local/binary"
import { findCodexBinary } from "./codex-local/binary"
import { CONTRIB_ENGINES, CONTRIB_ENGINE_IDS, pluginEngineIds } from "./contrib-engines"
import { findCopilotBinary } from "./copilot-local/binary"
import { readTextFileSyncBounded } from "./file-bounds"
import { findKimiBinary } from "./kimi-local/binary"
import { findOmpBinary, findPiBinary } from "./pi-local/binary"
import {
  bobAuthSecretsPath,
  claudeGlobalConfigPath,
  codexAuthPath,
  copilotConfigPath,
  kimiCredentialsPath,
} from "./vendor-home"

export type ClaudeAccount =
  | {
      kind: "oauth"
      email: string
      organization?: string
      displayName?: string
      billingType?: string
    }
  | { kind: "none" }

export type CodexAccount = { kind: "chatgpt"; email: string; plan?: string } | { kind: "apikey" } | { kind: "none" }

export type CopilotAccount =
  | { kind: "token"; source: "COPILOT_GITHUB_TOKEN" | "GH_TOKEN" | "GITHUB_TOKEN" }
  | { kind: "oauth" }
  | { kind: "none" }

/**
 * Kimi Code's OAuth bundle at `~/.kimi-code/credentials/kimi-code.json`.
 * Its JWT has no email claim (opaque ids only), so none is reported.
 */
export type KimiAccount = { kind: "oauth" } | { kind: "none" }

/**
 * Bob reports PRESENCE only. Its store holds a bearer token keyed
 * `bob.auth.tokens-<api host>` and nothing in plain text — the email the TUI
 * shows would have to be decoded out of the token, which Rove does not do to
 * credential material.
 */
export type BobAccount = { kind: "signed-in" } | { kind: "none" }

export type BinaryStatus = { found: true; path: string } | { found: false; error: string }

export interface EngineAccountStatus<A> {
  binary: BinaryStatus
  account: A
  /** Non-fatal error reading account state (file corrupt, JWT malformed, etc.). */
  accountError?: string
}

export interface DetectDeps {
  /** Returns the file contents, or null if the file doesn't exist. Throws on other I/O errors. */
  readFile(path: string): string | null
  env(name: string): string | undefined
  home(): string
  findClaudeBinary(): Promise<string>
  findCodexBinary(): Promise<string>
  findBobBinary(): Promise<string>
  findCopilotBinary(): Promise<string>
  findKimiBinary(): Promise<string>
  findPiBinary(): Promise<string>
  findOmpBinary(): Promise<string>
}

const defaultDeps: DetectDeps = {
  readFile(p: string): string | null {
    // Size-capped: an oversize/corrupt credential file reads as `null` like a
    // missing one — no OOM, no throw into the UI, no logged secret.
    return readTextFileSyncBounded(p)
  },
  env(name) {
    return process.env[name]
  },
  home() {
    return homedir()
  },
  findClaudeBinary() {
    return findClaudeBinary()
  },
  findCodexBinary() {
    return findCodexBinary()
  },
  findBobBinary() {
    return findBobBinary()
  },
  findCopilotBinary() {
    return findCopilotBinary()
  },
  findKimiBinary() {
    return findKimiBinary()
  },
  findPiBinary() {
    return findPiBinary()
  },
  findOmpBinary() {
    return findOmpBinary()
  },
}

/**
 * Decode a JWT payload WITHOUT verifying the signature: this only reads what
 * `codex login` wrote to disk; it authenticates nothing.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".")
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (!payload) return null
  // base64url → base64. Add `=` padding to a multiple of 4 length.
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  try {
    const json = Buffer.from(padded, "base64").toString("utf8")
    const obj = JSON.parse(json)
    return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function probeBinary(probe: () => Promise<string>): Promise<BinaryStatus> {
  try {
    const p = await probe()
    return { found: true, path: p }
  } catch (err) {
    // Every vendor's not-found error derives from this one.
    if (err instanceof BinaryNotFoundError) return { found: false, error: "not found on PATH" }
    return { found: false, error: errorMessage(err) }
  }
}

/**
 * Per-process memo of the production (default-deps) discovery. Installed CLIs
 * don't change mid-session, and the blocking `which` probes cost ~10-15ms of
 * render thread on every engine-cycle keypress, dialog open, and Ctrl+T.
 */
let cachedDefaultVendors: Promise<readonly VendorId[]> | null = null

async function probeAvailableVendors(deps: DetectDeps): Promise<readonly VendorId[]> {
  const probes: ReadonlyArray<readonly [VendorId, () => Promise<string>]> = [
    ["claude", () => deps.findClaudeBinary()],
    ["codex", () => deps.findCodexBinary()],
    ["copilot", () => deps.findCopilotBinary()],
    ["kimi", () => deps.findKimiBinary()],
    ["pi", () => deps.findPiBinary()],
    ["omp", () => deps.findOmpBinary()],
  ]
  const detected = await Promise.all(
    probes.map(async ([vendor, probe]) => ((await probeBinary(probe)).found ? vendor : null)),
  )
  return detected.filter((v): v is VendorId => v !== null)
}

/**
 * Built-in vendors whose CLI binary is found, in `BUILTIN_VENDORS` order.
 * Binary only — account state is NOT a gate. Probes run concurrently; a miss
 * excludes the vendor. Callers treat `[]` as "show all" so an empty selector
 * never blocks task creation.
 */
// NOT `async`: returns the cached promise VERBATIM (an async wrapper would
// mint a fresh one per call).
export function detectAvailableVendors(deps: DetectDeps = defaultDeps): Promise<readonly VendorId[]> {
  // Custom deps (tests, explicit re-checks) always re-probe.
  if (deps !== defaultDeps) return probeAvailableVendors(deps)
  if (cachedDefaultVendors) return cachedDefaultVendors
  // Cache the PROMISE so concurrent first calls share one probe; clear on
  // rejection so a later call can retry.
  const pending = probeAvailableVendors(deps).catch((err) => {
    cachedDefaultVendors = null
    throw err
  })
  cachedDefaultVendors = pending
  return pending
}

/** Drop both discovery memos so the next {@link detectAvailableVendors} /
 *  {@link availableEngineIds} re-probes (a UI "rescan"). */
export function resetAvailableVendorsCache(): void {
  cachedDefaultVendors = null
  cachedContribEngines = null
}

/**
 * Detected built-ins + custom engines + detected contrib/plugin engines.
 * Custom engines are never probed ("the user added it" = available; a
 * missing binary fails at launch). Custom ids are re-read from state.json on
 * EVERY call since Settings → Engines can change them; only probes are cached.
 */
export async function installedEngineIds(deps: DetectDeps = defaultDeps): Promise<readonly VendorId[]> {
  const builtins = await detectAvailableVendors(deps)
  const contrib = await detectContribEngines()
  // Custom ids win over a same-named contrib entry (dedup keeps the first).
  return [...new Set([...builtins, ...getCustomEngineIds(), ...contrib])]
}

/**
 * {@link installedEngineIds} minus engines switched OFF — the list to OFFER.
 * Settings reads the installed list so a disabled engine keeps its row.
 */
export async function availableEngineIds(deps: DetectDeps = defaultDeps): Promise<readonly VendorId[]> {
  const disabled = new Set(getDisabledEngineIds())
  return (await installedEngineIds(deps)).filter((id) => !disabled.has(id))
}

/**
 * Per-process memo of contrib-engine discovery: offered when
 * `defaultCommand[0]` (the binary launch would run) is on PATH.
 */
let cachedContribEngines: Promise<readonly VendorId[]> | null = null

function detectContribEngines(): Promise<readonly VendorId[]> {
  if (cachedContribEngines) return cachedContribEngines
  // `Bun.which` is absent under vitest (node) — reads as "none detected".
  const which: ((bin: string) => string | null) | undefined = globalThis.Bun?.which
  // Plugin engines are offered unconditionally, like custom engines.
  cachedContribEngines = Promise.resolve([
    ...(which
      ? CONTRIB_ENGINE_IDS.filter((id) => {
          const bin = CONTRIB_ENGINES[id]?.defaultCommand[0]
          return bin ? which(bin) !== null : false
        })
      : []),
    ...pluginEngineIds(),
  ])
  return cachedContribEngines
}

export async function detectClaudeAccount(deps: DetectDeps = defaultDeps): Promise<EngineAccountStatus<ClaudeAccount>> {
  const binary = await probeBinary(() => deps.findClaudeBinary())
  const configPath = claudeGlobalConfigPath(deps.env, deps.home())
  let raw: string | null
  try {
    raw = deps.readFile(configPath)
  } catch (err) {
    return {
      binary,
      account: { kind: "none" },
      accountError: `read ${configPath}: ${errorMessage(err)}`,
    }
  }
  if (raw === null) return { binary, account: { kind: "none" } }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      binary,
      account: { kind: "none" },
      accountError: `parse ${configPath}: ${errorMessage(err)}`,
    }
  }
  const oauth = (parsed as { oauthAccount?: unknown } | null)?.oauthAccount
  if (!oauth || typeof oauth !== "object") return { binary, account: { kind: "none" } }
  const o = oauth as Record<string, unknown>
  const email = typeof o.emailAddress === "string" ? o.emailAddress : undefined
  if (!email) return { binary, account: { kind: "none" } }
  return {
    binary,
    account: {
      kind: "oauth",
      email,
      organization: typeof o.organizationName === "string" ? o.organizationName : undefined,
      displayName: typeof o.displayName === "string" ? o.displayName : undefined,
      billingType: typeof o.billingType === "string" ? o.billingType : undefined,
    },
  }
}

export async function detectCodexAccount(deps: DetectDeps = defaultDeps): Promise<EngineAccountStatus<CodexAccount>> {
  const binary = await probeBinary(() => deps.findCodexBinary())
  const authPath = codexAuthPath(deps.env, deps.home())
  let raw: string | null
  try {
    raw = deps.readFile(authPath)
  } catch (err) {
    return {
      binary,
      account: { kind: "none" },
      accountError: `read ${authPath}: ${errorMessage(err)}`,
    }
  }
  if (raw === null) return { binary, account: { kind: "none" } }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      binary,
      account: { kind: "none" },
      accountError: `parse ${authPath}: ${errorMessage(err)}`,
    }
  }
  const obj = (parsed ?? {}) as Record<string, unknown>
  const tokens = obj.tokens as { id_token?: unknown } | undefined
  const idToken = typeof tokens?.id_token === "string" ? tokens.id_token : undefined
  if (idToken) {
    const payload = decodeJwtPayload(idToken)
    if (!payload) {
      return {
        binary,
        account: { kind: "none" },
        accountError: "codex id_token: malformed JWT",
      }
    }
    const email = typeof payload.email === "string" ? payload.email : undefined
    // Plan info lives under the namespaced claim `https://api.openai.com/auth`.
    const authClaimRaw = payload["https://api.openai.com/auth"]
    const authClaim =
      typeof authClaimRaw === "object" && authClaimRaw !== null && !Array.isArray(authClaimRaw)
        ? (authClaimRaw as Record<string, unknown>)
        : undefined
    const plan = typeof authClaim?.chatgpt_plan_type === "string" ? authClaim.chatgpt_plan_type : undefined
    if (email) return { binary, account: { kind: "chatgpt", email, plan } }
    // Token but no email: an error, not a silent "not logged in".
    return { binary, account: { kind: "none" }, accountError: "codex id_token: no email claim" }
  }
  const apiKey = obj.OPENAI_API_KEY
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return { binary, account: { kind: "apikey" } }
  }
  return { binary, account: { kind: "none" } }
}

export async function detectCopilotAccount(
  deps: DetectDeps = defaultDeps,
): Promise<EngineAccountStatus<CopilotAccount>> {
  const binary = await probeBinary(() => deps.findCopilotBinary())
  for (const source of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const) {
    if (deps.env(source)?.trim()) return { binary, account: { kind: "token", source } }
  }

  const configPath = copilotConfigPath(deps.env, deps.home())
  let raw: string | null
  try {
    raw = deps.readFile(configPath)
  } catch (err) {
    return {
      binary,
      account: { kind: "none" },
      accountError: `read ${configPath}: ${errorMessage(err)}`,
    }
  }
  if (raw === null) return { binary, account: { kind: "none" } }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      binary,
      account: { kind: "none" },
      accountError: `parse ${configPath}: ${errorMessage(err)}`,
    }
  }

  if (!isRecord(parsed)) return { binary, account: { kind: "none" } }
  if (
    hasStringDeep(parsed, [
      "github_token",
      "oauth_token",
      "access_token",
      "token",
      "selectedUser",
      "currentUser",
      "user",
    ])
  ) {
    return { binary, account: { kind: "oauth" } }
  }
  return { binary, account: { kind: "none" } }
}

/**
 * Logged in or not, never who. The token key's PREFIX is matched because it
 * carries the API host (`bob.auth.tokens-https://api.us-east.bob.ibm.com`),
 * which differs per region.
 */
export async function detectBobAccount(deps: DetectDeps = defaultDeps): Promise<EngineAccountStatus<BobAccount>> {
  const binary = await probeBinary(() => deps.findBobBinary())
  const secretsPath = bobAuthSecretsPath(deps.home())
  let raw: string | null
  try {
    raw = deps.readFile(secretsPath)
  } catch (err) {
    return { binary, account: { kind: "none" }, accountError: `read ${secretsPath}: ${errorMessage(err)}` }
  }
  if (raw === null) return { binary, account: { kind: "none" } }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { binary, account: { kind: "none" }, accountError: `parse ${secretsPath}: ${errorMessage(err)}` }
  }
  if (!isRecord(parsed)) return { binary, account: { kind: "none" } }
  const signedIn = Object.entries(parsed).some(
    ([key, value]) => key.startsWith("bob.auth.tokens-") && typeof value === "string" && value.length > 0,
  )
  return { binary, account: signedIn ? { kind: "signed-in" } : { kind: "none" } }
}

export async function detectKimiAccount(deps: DetectDeps = defaultDeps): Promise<EngineAccountStatus<KimiAccount>> {
  const binary = await probeBinary(() => deps.findKimiBinary())
  const credPath = kimiCredentialsPath(deps.env, deps.home())
  let raw: string | null
  try {
    raw = deps.readFile(credPath)
  } catch (err) {
    return { binary, account: { kind: "none" }, accountError: `read ${credPath}: ${errorMessage(err)}` }
  }
  if (raw === null) return { binary, account: { kind: "none" } }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { binary, account: { kind: "none" }, accountError: `parse ${credPath}: ${errorMessage(err)}` }
  }
  if (!isRecord(parsed)) return { binary, account: { kind: "none" } }
  const token = parsed.access_token
  if (typeof token === "string" && token.length > 0) return { binary, account: { kind: "oauth" } }
  return { binary, account: { kind: "none" } }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function hasStringDeep(value: unknown, interestingKeys: readonly string[], depth = 0): boolean {
  if (depth > 4 || !isRecord(value)) return false
  for (const [key, entry] of Object.entries(value)) {
    if (interestingKeys.includes(key) && typeof entry === "string" && entry.length > 0) return true
    if (isRecord(entry) && hasStringDeep(entry, interestingKeys, depth + 1)) return true
  }
  return false
}
