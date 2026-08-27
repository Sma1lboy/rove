/**
 * Doctor check: is the ENGINE HOOK CHANNEL actually live?
 *
 * Hooks are the only low-latency path to the sidebar badge. When they stop
 * arriving nothing breaks loudly: `kobe hook` is best-effort by contract
 * (never spawns a daemon, always exits 0, swallows every failure), and the
 * daemon's activity observer keeps painting the badges off a ~10s poll. The
 * UI therefore looks *slow*, not broken — the shape of the 2026-08-26 field
 * report, where every badge lagged 2-3s because an engine's inherited
 * `*_DAEMON_SOCKET_PATH` still pointed at the pre-rename `.kobe` socket and
 * every hook silently dropped its event.
 *
 * The tell is already in `debug.inspect`: each tab entry records whether its
 * activity came from a `hook` or from `observed` polling. Live engine tabs
 * with ZERO hook-sourced entries means the channel is down, and that is a
 * read — no probe event, so doctor stays read-only.
 *
 * Deliberately only reports "no hook events at all". A per-tab verdict would
 * be wrong: a tab that has merely been idle since the daemon started has no
 * hook entry yet and is perfectly healthy.
 */

/** One tab's activity entry, as `debug.inspect` reports it. */
export interface InspectTabEntry {
  readonly source?: string
  readonly state?: string
}

export interface HookChannelInput {
  /** `debug.inspect`'s `activity.tabs`: taskId → tabId → entry. */
  readonly tabs: Readonly<Record<string, Readonly<Record<string, InspectTabEntry>>>>
  /** The daemon socket the CLI resolved — echoed in the failure hint. */
  readonly socketPath: string
  /** A `*_DAEMON_SOCKET_PATH` override in THIS process's env, when set. */
  readonly socketOverride?: string
}

export type HookChannelVerdict =
  | { readonly kind: "no-tabs" }
  | { readonly kind: "live"; readonly hookTabs: number; readonly totalTabs: number }
  | { readonly kind: "down"; readonly totalTabs: number }

/**
 * Classify the hook channel from an inspect snapshot. Pure.
 *
 * `down` requires tabs to exist AND none of them to carry a hook-sourced
 * entry: with no tabs at all there is simply nothing to conclude, which is
 * why that is its own verdict rather than a failure.
 */
export function classifyHookChannel(input: HookChannelInput): HookChannelVerdict {
  let total = 0
  let hooked = 0
  for (const tabs of Object.values(input.tabs)) {
    for (const entry of Object.values(tabs)) {
      total++
      if (entry.source === "hook") hooked++
    }
  }
  if (total === 0) return { kind: "no-tabs" }
  if (hooked === 0) return { kind: "down", totalTabs: total }
  return { kind: "live", hookTabs: hooked, totalTabs: total }
}

/**
 * Render the verdict as doctor lines. `cliName` keeps the remediation hint
 * in whichever name the user invoked (`rove` / `kobe`).
 */
export function hookChannelDoctorLines(
  verdict: HookChannelVerdict,
  input: Pick<HookChannelInput, "socketPath" | "socketOverride">,
  cliName: string,
): string[] {
  if (verdict.kind === "no-tabs") return ["hooks:   — no engine tabs yet (nothing to check)"]
  if (verdict.kind === "live") {
    return [`hooks:   ✓ engine hook channel live (${verdict.hookTabs}/${verdict.totalTabs} tab(s) hook-sourced)`]
  }
  const out = [
    `hooks:   ✗ NO hook events reaching the daemon (0/${verdict.totalTabs} tab(s) hook-sourced)`,
    "         badges fall back to a ~10s poll, so activity looks seconds late",
    `         daemon socket: ${input.socketPath}`,
  ]
  // The failure that produced this check: an engine (and every hook it
  // forks) inherited a socket path that no longer exists, so the hook
  // connected to nothing and dropped the event without a word.
  if (input.socketOverride && input.socketOverride !== input.socketPath) {
    out.push(`         ⚠ env override points elsewhere: ${input.socketOverride}`)
  }
  out.push(
    `         → restart the engine tabs (they may hold a stale socket path), or run \`${cliName} daemon restart\``,
    `         → debug one hook directly: \`KOBE_HOOK_DEBUG=1 echo '{}' | ${cliName} hook turn-start --engine claude\``,
  )
  return out
}
