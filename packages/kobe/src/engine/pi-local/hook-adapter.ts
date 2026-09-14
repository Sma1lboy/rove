/**
 * pi-family hook adapter — the Rove side of the state channel for `pi` and
 * `omp`. See `./extension-source.ts` for what the installed file does and
 * which events it reports; this module owns WHERE it lives, WHAT the CLI's
 * payload means, and how a bad install refuses without breaking a launch.
 *
 * One class for both vendors: they are the same product family (omp is
 * Stencil Labs' fork of pi) and share the extension API, the
 * `PI_CODING_AGENT_DIR` override and the session store layout. Only the
 * default agent directory and the `--engine <id>` tag differ, so the vendor
 * is a constructor argument rather than a subclass.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import type { HookEditOutcome } from "../json-hooks.ts"
import { type VendorHomeDeps, vendorAgentDir } from "../vendor-home.ts"
import { renderPiExtensionSource } from "./extension-source.ts"

/** The pi-family vendors this adapter serves. */
export type PiFamilyVendor = "pi" | "omp"

/** The one file Rove manages inside the agent dir. */
export const ACTIVITY_EXTENSION_FILE = "rove-activity.ts"

/** `<agentDir>/extensions` — where both CLIs discover extension modules. */
export function piExtensionsDir(vendor: PiFamilyVendor, deps?: VendorHomeDeps): string {
  return path.join(vendorAgentDir(vendor, deps), "extensions")
}

/** The Rove-managed extension module for `vendor`, at its install path. */
export function piActivityExtensionPath(vendor: PiFamilyVendor, deps?: VendorHomeDeps): string {
  return path.join(piExtensionsDir(vendor, deps), ACTIVITY_EXTENSION_FILE)
}

/**
 * Provider failure text → the neutral failure class. Heuristic on purpose:
 * neither CLI gives a stable error CODE here — they hand us the provider's own
 * message (`400 ...`, `Rate limit exceeded`, `insufficient credits`) — so the
 * classes are read off the two things the daemon acts on differently.
 *
 * `rate_limit` arms the daemon's auto-resume timer (it will retry on its
 * own); `billing` does NOT, because an exhausted balance needs a human. A
 * generic 429 is a rate limit, but a 402 / "insufficient credits" is billing
 * even though both arrive as four-hundreds.
 */
function piFailureDetail(payload: Record<string, unknown>): EngineActivityDetail {
  const raw = typeof payload.error_message === "string" ? payload.error_message : ""
  const message = raw.toLowerCase()
  const note = raw ? raw.slice(0, 200) : undefined
  const failure: NonNullable<EngineActivityDetail["failure"]> = (() => {
    if (/insufficient|credit|billing|payment required|\b402\b|quota exceeded|out of credits/.test(message)) {
      return "billing"
    }
    if (/rate.?limit|too many requests|\b429\b|overloaded|capacity/.test(message)) return "rate_limit"
    return "other"
  })()
  return { failure, ...(note ? { note } : {}) }
}

export class PiFamilyHookAdapter implements EngineHookAdapter {
  readonly vendor: VendorId

  constructor(private readonly family: PiFamilyVendor) {
    this.vendor = family
  }

  supportsHooks(): boolean {
    return true
  }

  /** Not a settings file: the extension module the CLI loads. */
  globalSettingsPath(): string {
    return piActivityExtensionPath(this.family)
  }

  /**
   * The hook payload is Rove's own (see `extension-source.ts`), so this
   * vocabulary is the extension's, not the CLI's — except `error_message`,
   * which the extension copies straight out of the engine's message.
   */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    if (kind === "turn-failed") return piFailureDetail(payload)
    // The extension says WHICH wait it is: an approval prompt blocks on a
    // decision, the question tool blocks on an answer, and plugin subscribers
    // get a different event for each.
    if (kind === "awaiting-input") return { waiting: payload.waiting === "input" ? "input" : "permission" }
    if (kind === "tool-pre" || kind === "tool-post" || kind === "tool-failed") {
      const name = typeof payload.tool_name === "string" ? payload.tool_name : undefined
      return { tool: { ...(name ? { name } : {}) } }
    }
    return undefined
  }

  /** The extension reports the CLI's own `sessionManager` identity. */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined
    if (!sessionId) return undefined
    const transcriptPath = typeof payload.transcript_path === "string" ? payload.transcript_path : undefined
    return { sessionId, ...(transcriptPath ? { transcriptPath } : {}) }
  }

  async installActivityHooks(settingsFilePath: string, opts: { toolEvents?: boolean } = {}): Promise<HookEditOutcome> {
    // Don't materialize ~/.pi or ~/.omp for someone who never installed that
    // CLI — with no agent directory there is no engine to read the extension.
    // Not a refusal (same contract as the Kimi adapter): nothing is missing.
    // Derived from the given path (`<agentDir>/extensions/<file>`) rather than
    // from `vendorAgentDir`, so the existence check always describes the same
    // tree the write would land in.
    const agentDir = path.dirname(path.dirname(settingsFilePath))
    if (!existsSync(agentDir)) return { ok: true }
    const source = renderPiExtensionSource({
      vendor: this.family,
      invocation: kobeHookInvocation(),
      toolEvents: opts.toolEvents ?? false,
    })
    await writeIfChanged(settingsFilePath, source)
    return { ok: true }
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    try {
      await rm(settingsFilePath, { force: true })
    } catch {
      /* best-effort — never block launch */
    }
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* The pi family never had a WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }
}

/**
 * Write `content` only when it differs, so a reinstall on every launch leaves
 * the file's mtime alone (the same "skip the write when the transform is a
 * no-op" contract as the JSON and TOML adapters — a rewrite per launch would
 * invalidate every editor's state and re-read the file for nothing).
 */
async function writeIfChanged(file: string, content: string): Promise<void> {
  try {
    const current = await readFile(file, "utf8").catch(() => undefined)
    if (current === content) return
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  } catch {
    /* best-effort — never block launch */
  }
}
