/**
 * OpenCode-family hook adapter — the Rove side of the state channel for
 * `opencode` and `kilo`. See `./plugin-source.ts` for what the installed
 * module does and which events it reports; this module owns WHERE it lives,
 * WHAT its payload means, and how a bad install refuses without breaking a
 * launch.
 *
 * One class for both vendors: kilo is an OpenCode fork and exposes the same
 * plugin surface (the same handler names, the same event `type` vocabulary).
 * Only two things differ, so both are constructor arguments rather than
 * subclasses: the config directory (`~/.config/opencode` vs `~/.config/kilo`)
 * and the plugin subdirectory each CLI scans (`plugins/` vs `plugin/`).
 *
 * Not {@link JsonHookAdapter} and not `../flat-hooks.ts`: there is no settings
 * document to merge into. The install writes one file Rove owns outright, so
 * removal is a delete and idempotence is "the bytes are already identical".
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import type { HookEditOutcome } from "../json-hooks.ts"
import { renderOpencodePluginSource } from "./plugin-source.ts"

/** The OpenCode-family vendors this adapter serves. */
export type OpencodeFamilyVendor = "opencode" | "kilo"

/** The one file Rove manages inside the plugin directory. */
const ACTIVITY_PLUGIN_FILE = "rove-agent-state.js"

/**
 * Config directory + the plugin subdirectory that CLI scans. Both keep their
 * config under XDG's `~/.config/<name>`; the subdirectory spelling is the
 * vendor's own, and writing into the other one leaves a file nothing loads.
 */
const FAMILY_DIRS: Readonly<Record<OpencodeFamilyVendor, { readonly configDir: string; readonly pluginDir: string }>> =
  {
    opencode: { configDir: "opencode", pluginDir: "plugins" },
    kilo: { configDir: "kilo", pluginDir: "plugin" },
  }

/** `~/.config/<vendor>` — the directory whose absence means "never installed". */
export function opencodeFamilyConfigDir(vendor: OpencodeFamilyVendor, home: string = homedir()): string {
  return path.join(home, ".config", FAMILY_DIRS[vendor].configDir)
}

/** The Rove-managed plugin module for `vendor`, at its install path. */
export function opencodeFamilyPluginPath(vendor: OpencodeFamilyVendor, home: string = homedir()): string {
  return path.join(opencodeFamilyConfigDir(vendor, home), FAMILY_DIRS[vendor].pluginDir, ACTIVITY_PLUGIN_FILE)
}

/**
 * Provider failure text → the neutral failure class. Heuristic on purpose:
 * `session.error` hands over the provider's own message rather than a stable
 * code, and the two classes downstream act on differently are rate limiting
 * (the daemon's auto-resume timer will retry) and billing (which needs a
 * human, so it must NOT arm that timer).
 */
function opencodeFailureDetail(payload: Record<string, unknown>): EngineActivityDetail {
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

export class OpencodeFamilyHookAdapter implements EngineHookAdapter {
  readonly vendor: VendorId

  constructor(private readonly family: OpencodeFamilyVendor) {
    this.vendor = family
  }

  supportsHooks(): boolean {
    return true
  }

  /** Not a settings file: the plugin module the CLI loads. */
  globalSettingsPath(): string {
    return opencodeFamilyPluginPath(this.family)
  }

  /** The payload is Rove's own (see `./plugin-source.ts`), except
   *  `error_message`, copied straight out of the CLI's error event. */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    if (kind === "turn-failed") return opencodeFailureDetail(payload)
    if (kind === "awaiting-input") return { waiting: payload.waiting === "input" ? "input" : "permission" }
    return undefined
  }

  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : undefined
    return sessionId ? { sessionId } : undefined
  }

  async installActivityHooks(settingsFilePath: string): Promise<HookEditOutcome> {
    // Don't materialize `~/.config/opencode` for someone who never installed
    // the CLI — with no config directory there is nothing to load the plugin.
    // Not a refusal (same contract as the pi and cursor adapters): the engine
    // simply isn't here. Derived from the given path
    // (`<configDir>/<pluginDir>/<file>`) so the check always describes the
    // tree the write would land in.
    const configDir = path.dirname(path.dirname(settingsFilePath))
    if (!existsSync(configDir)) return { ok: true }
    const source = renderOpencodePluginSource({ vendor: this.family, invocation: kobeHookInvocation() })
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
    /* This family never had a WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }
}

/**
 * Write `content` only when it differs, so a reinstall on every launch leaves
 * the file's mtime alone — a rewrite per launch would make every watcher
 * re-read a file whose bytes never changed.
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
