/**
 * Which interactive engine CLI (not the headless path, e.g. not `codex
 * exec`) to launch in a task's hosted PTY. Defaults live on the registry's
 * `defaultCommand`; this layers the user's per-vendor override on top, and
 * every launch site goes through it.
 *
 * The override (Settings → Engines) is a shell-ish command STRING in the
 * shared `state.json` under {@link engineCommandKey}, read via the
 * cross-process {@link getPersistedString} because the Tasks pane runs in
 * its own process and can't share the TUI's reactive KV. Empty/unset → the
 * built-in default.
 */

import { roveCliInvocation } from "@/cli/invocation"
import { engineEntry } from "@/engine/registry"
import { getPersistedString } from "@/state/repos"
import type { VendorId } from "@/types/task"
import { coerceVendorId } from "@/types/vendor"

/** state.json key holding a vendor's launch-command override string. */
export function engineCommandKey(vendor: VendorId): string {
  return `engineCommand.${vendor}`
}

/**
 * state.json key holding a vendor's DISPLAY-NAME override. Empty/unset → the
 * registry's display name, so resetting an engine is clearing both keys.
 */
export function engineNameKey(vendor: VendorId): string {
  return `engineName.${vendor}`
}

/**
 * Display name for an engine id, read cross-process from state.json (for
 * places without the reactive settings kv): the `engineName.<id>` override,
 * else the registry's display name.
 */
export function engineDisplayName(vendor: VendorId): string {
  const override = getPersistedString(engineNameKey(vendor))?.trim()
  // engineEntry answers every id: built-in labels, contrib catalog names
  // ("Gemini CLI"), and the id itself for a plain custom engine.
  return override || engineEntry(vendor).displayName
}

/**
 * `my-local-agent` → `My Local Agent`, for a custom engine added with no name.
 *
 * PURE, unlike {@link engineDisplayName}: this is the fallback written INTO
 * `engineName.<id>`, so consulting the override would clobber a user-typed
 * name on the next write.
 */
export function humanizeSlug(id: string): string {
  return id
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Built-in default launch argv (undefined → claude). A custom engine's
 * command is its `engineCommand.<id>` override, read first by
 * {@link interactiveEngineCommand}; if that is empty the registry runs a bare
 * binary named after the id rather than silently launching claude.
 */
export function defaultEngineCommand(vendor: VendorId | undefined): readonly string[] {
  return engineEntry(coerceVendorId(vendor)).defaultCommand
}

/**
 * Split a command string into argv with shell-like quoting: a quote may open
 * anywhere in a token (`--x="be terse"` and `--x "be terse"` both work) and
 * concatenates with adjacent text; the other quote kind is literal inside
 * (`--x='a "b" c'` → `--x=a "b" c`); an unterminated quote runs to the end.
 * Total, never throws; `[]` for blank input.
 */
export function parseEngineCommand(command: string): string[] {
  const out: string[] = []
  let token = ""
  let hasToken = false // distinguishes an empty quoted arg ("") from no arg
  let quote: '"' | "'" | null = null
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else token += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        out.push(token)
        token = ""
        hasToken = false
      }
      continue
    }
    token += ch
    hasToken = true
  }
  if (hasToken) out.push(token)
  return out
}

export function interactiveEngineCommand(
  vendor: VendorId | undefined,
  effort?: string,
  model?: string,
): readonly string[] {
  const v: VendorId = coerceVendorId(vendor)
  const override = getPersistedString(engineCommandKey(v))?.trim()
  const base = (() => {
    if (override) {
      const argv = parseEngineCommand(override)
      if (argv.length > 0) return argv
    }
    return defaultEngineCommand(v)
  })()
  return withEngineTerminalTitle(withEngineModel(withEngineEffort(base, v, effort), v, model), v)
}

/**
 * Apply an engine-owned interactive terminal-title policy. The registry
 * carries the argv because Codex's `-c tui.terminal_title=...` syntax is an
 * adapter concern; launch sites and tab chrome remain vendor-neutral.
 */
export function withEngineTerminalTitle(argv: readonly string[], vendor: VendorId | undefined): readonly string[] {
  const args = engineEntry(coerceVendorId(vendor)).terminalTitle?.launchArgs
  return args && args.length > 0 ? [...argv, ...args] : argv
}

/**
 * Apply the engine's adapter-declared effort argv
 * ({@link EngineRegistryEntry.effortArgv}) when `effort` is one of its
 * {@link EngineRegistryEntry.effortLevels}. An unknown level is dropped: a
 * bogus value makes the engine refuse to launch. Never key this off a literal
 * vendor id, or a declared level passes every picker and is silently dropped
 * at launch.
 *
 * `vendor` must be PROTOCOL-RESOLVED by the caller: a preset `mycodex` on the
 * codex protocol takes codex's effort argv.
 */
export function withEngineEffort(
  argv: readonly string[],
  vendor: VendorId | undefined,
  effort: string | undefined,
): readonly string[] {
  const trimmed = effort?.trim()
  if (!trimmed) return argv
  const entry = engineEntry(coerceVendorId(vendor))
  if (!entry.effortLevels?.includes(trimmed)) return argv
  return entry.effortArgv?.(argv, trimmed) ?? argv
}

/**
 * Model twin of {@link withEngineEffort}, minus the closed-set check: a model
 * is a free string (pi takes a fuzzy pattern). `assertEngineAcceptsModel`
 * gates records upstream; here an engine without
 * {@link EngineRegistryEntry.modelArgv} drops the model rather than guessing a
 * flag. `vendor` must be PROTOCOL-RESOLVED.
 */
export function withEngineModel(
  argv: readonly string[],
  vendor: VendorId | undefined,
  model: string | undefined,
): readonly string[] {
  const trimmed = model?.trim()
  if (!trimmed) return argv
  return engineEntry(coerceVendorId(vendor)).modelArgv?.(argv, trimmed) ?? argv
}

export { argvHasFlag } from "../cli/argv.ts"

/**
 * Shell-ready `… api` prefix for protocol prompts, from {@link
 * roveCliInvocation}: packaged builds bake the bare CLI name, a source
 * checkout the dev entry. Otherwise a dev-sandbox agent would hit a STALE
 * global install on PATH and newer verbs would die with BAD_VERB.
 */
export function kobeApiInvocation(): string {
  const quote = (a: string): string => (/^[A-Za-z0-9_/.:=-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)
  try {
    return [...roveCliInvocation(), "api"].map(quote).join(" ")
  } catch {
    // import.meta.resolve is unavailable in some hosts (vitest's SSR
    // transform) — bare `rove api` is the best-effort fallback there.
    return "rove api"
  }
}

/**
 * The system-prompt protocols live in `./worktree-protocol.ts`: they resolve
 * through `sessionProtocol()` in `engine-presets.ts`, which imports THIS
 * module, so putting them here would close an import cycle.
 *
 * Anything gating on "is this a claude launch" belongs behind
 * `sessionProtocol()`, never a literal id compare.
 */
