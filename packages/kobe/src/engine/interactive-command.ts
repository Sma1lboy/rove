/**
 * Which interactive engine CLI to launch in a task's hosted PTY.
 *
 * The "middle" pane of a task session runs a vendor's *interactive* CLI
 * (the same binary a human would run in a terminal) — not the headless
 * path. The vendor → default-argv mapping itself lives on the engine
 * registry (`registry.ts` `defaultCommand`); this module layers the
 * user's per-vendor override on top. Every launch site (the outer
 * monitor's Handover and the Tasks-pane switch) goes through this.
 *
 * Codex's bare `codex` (no subcommand) opens its interactive TUI, the
 * same way bare `claude` does — `codex exec` is the headless path we
 * deliberately don't use here.
 *
 * Per-vendor OVERRIDE: the launch command is configurable in
 * Settings → Engines, so a user whose binary isn't on PATH as `claude`
 * (e.g. it's `cl`) or who wants default flags (`claude --model …`) can
 * set their own. The override is a shell-ish command STRING persisted in
 * the shared `state.json` under {@link engineCommandKey}; we read it with
 * the cross-process {@link getPersistedString} (the Tasks-pane runs in
 * its own process, so it can't share the TUI's reactive KV — both read
 * the same file instead). Empty / unset →
 * the built-in default.
 */

import { roveCliInvocation } from "@/cli/invocation"
import { engineEntry } from "@/engine/registry"
import { getPersistedString } from "@/state/repos"
import type { VendorId } from "@/types/task"
import { BUILTIN_VENDORS, coerceVendorId } from "@/types/vendor"

/**
 * Human label for a vendor (Settings → Engines rows). Sourced from the
 * engine registry's `displayName` — the registry is the one place
 * built-in identity lives; this record stays exported for the settings
 * dialog's existing import.
 */
const VENDOR_LABEL: Record<VendorId, string> = Object.fromEntries(
  BUILTIN_VENDORS.map((v) => [v, engineEntry(v).displayName]),
) as Record<VendorId, string>

/** state.json key holding a vendor's launch-command override string. */
export function engineCommandKey(vendor: VendorId): string {
  return `engineCommand.${vendor}`
}

/**
 * state.json key holding a vendor's custom DISPLAY-NAME override.
 * Parallel to {@link engineCommandKey}; an empty/unset value means "use the
 * built-in {@link VENDOR_LABEL}", so resetting an engine to default is just
 * clearing both keys — no sentinel value.
 */
export function engineNameKey(vendor: VendorId): string {
  return `engineName.${vendor}`
}

/**
 * Display name for an engine id, resolved cross-process from the shared
 * state.json: the user's custom name override (`engineName.<id>`) when set,
 * else the built-in {@link VENDOR_LABEL}, else the id itself (a custom
 * engine with no name set). Used where the reactive settings kv isn't
 * available — e.g. the quick-task composer's engine chips.
 */
export function engineDisplayName(vendor: VendorId): string {
  const override = getPersistedString(engineNameKey(vendor))?.trim()
  // engineEntry answers every id: built-in labels, contrib catalog names
  // ("Gemini CLI"), and the id itself for a plain custom engine.
  return override || engineEntry(vendor).displayName
}

/**
 * Turn a custom-engine slug into a presentable display name: split on
 * `-`/`_` and title-case each word. `my-local-agent` → `My Local Agent`.
 * Used so a custom engine added with no name still reads like the
 * title-cased built-ins instead of its raw lowercase-hyphenated id.
 *
 * Deliberately a PURE string transform, unlike {@link engineDisplayName}: this
 * is the fallback written INTO `engineName.<id>` when the user typed no name,
 * so consulting the override here would overwrite a user-typed name with the
 * title-cased slug on the next write.
 */
export function humanizeSlug(id: string): string {
  return id
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Built-in default launch argv for a vendor (undefined → claude), read
 * from the engine registry. A custom engine id has no built-in default —
 * its command lives in the `engineCommand.<id>` override the user set when
 * adding it, which {@link interactiveEngineCommand} reads first; the
 * registry's custom entry only fires if that override is somehow empty, in
 * which case we run a bare binary named after the id rather than silently
 * launching claude.
 */
export function defaultEngineCommand(vendor: VendorId | undefined): readonly string[] {
  return engineEntry(coerceVendorId(vendor)).defaultCommand
}

/**
 * Split a command string into argv, honouring single/double quotes so a
 * flag value with a space survives — in BOTH the separated form
 * (`claude --append-system-prompt "be terse"`) and the attached form
 * (`claude --append-system-prompt="be terse"`, the common CLI idiom).
 * Whitespace-separated otherwise. A quote may open anywhere in a token and
 * its content concatenates with the surrounding unquoted text, matching a
 * shell's word-splitting; the other quote kind is literal inside a quoted
 * span (`--x='a "b" c'` → `--x=a "b" c`). An unterminated quote runs to the
 * end of the string. Pure, total, never throws. Returns `[]` for blank input.
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

export function interactiveEngineCommand(vendor: VendorId | undefined, effort?: string): readonly string[] {
  const v: VendorId = coerceVendorId(vendor)
  const override = getPersistedString(engineCommandKey(v))?.trim()
  const base = (() => {
    if (override) {
      const argv = parseEngineCommand(override)
      if (argv.length > 0) return argv
    }
    return defaultEngineCommand(v)
  })()
  return withEngineTerminalTitle(withEngineEffort(base, v, effort), v)
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
 * Apply the engine's own reasoning/effort argv when `effort` is set AND valid
 * for it (per the registry's {@link EngineRegistryEntry.effortLevels}). Both
 * halves are DECLARED by the adapter: the levels it accepts and the argv that
 * carries one ({@link EngineRegistryEntry.effortArgv}). An unknown level is
 * dropped rather than passed through — a bogus value makes the engine refuse
 * to launch.
 *
 * Keying the argv off a literal vendor id instead would let an engine that
 * declares `effortLevels` have its level accepted by the gate, shown in the
 * TUI and web pickers, threaded through `/api/engines`, and then silently
 * dropped at launch — the user picks "high" and gets the default, with no
 * error.
 *
 * `vendor` must already be PROTOCOL-RESOLVED by the caller (both call sites
 * do): a preset `mycodex` declaring the codex protocol is a codex launch and
 * takes codex's effort argv.
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

// `argvHasFlag` lives in `../cli/argv.ts` (neutral, no engine import) so the
// CLI value-flag parsers share it; re-exported here for the engine callers.
export { argvHasFlag } from "../cli/argv.ts"

/**
 * Shell-ready `… api` command prefix for protocol prompts. Packaged builds
 * bake plain `kobe api`; a source checkout bakes the dev invocation
 * (`bun --preload … src/cli/kobe.ts api`) — the same {@link
 * roveCliInvocation} every kobe-owned pane uses. Without this, a protocol
 * agent in a dev sandbox resolves `kobe` to whatever STALE global install
 * is on PATH, and any verb newer than that install dies with BAD_VERB.
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
 * The system-prompt PROTOCOLS (`statusReportProtocol` / `noteFilingProtocol` /
 * `noteRecallProtocol` / `worktreeProtocol` / `dispatcherProtocol` and their
 * `with*` injectors) live in `./worktree-protocol.ts`, not here. They resolve
 * a launch's protocol through `sessionProtocol()` in `engine-presets.ts`, and
 * that module imports THIS one, so resolving a protocol here would close an
 * import cycle. Keeping the block one file over also keeps both files under
 * the size cap.
 *
 * Anything that gates on "is this launch a claude launch" belongs behind
 * `sessionProtocol()`, never a literal id compare.
 */
