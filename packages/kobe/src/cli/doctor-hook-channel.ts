/**
 * Doctor check: is the ENGINE HOOK CHANNEL actually live?
 *
 * Hooks are the only low-latency path to the sidebar badge. When they stop
 * arriving nothing breaks loudly: `kobe hook` is best-effort by contract
 * (never spawns a daemon, always exits 0, swallows every failure), and the
 * daemon's activity observer keeps painting the badges off a ~10s poll. The
 * UI therefore looks *slow*, not broken: every badge lags 2-3s, and the
 * usual cause is an engine whose inherited `*_DAEMON_SOCKET_PATH` points at
 * a socket nothing is listening on, so every hook drops its event.
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

import type { HookConfigIssue } from "../engine/hook-config-check.ts"

/** The one field of a `debug.inspect` tab entry this check reads. */
interface InspectTabEntry {
  readonly source?: string
}

export interface HookChannelInput {
  /** `debug.inspect`'s `activity.tabs`: taskId → tabId → entry. */
  readonly tabs: Readonly<Record<string, Readonly<Record<string, InspectTabEntry>>>>
  /**
   * The daemon socket this CLI resolved — echoed in the failure hint so the
   * reader can compare it against what their engine tabs actually hold.
   *
   * Deliberately NOT cross-checked against a `*_DAEMON_SOCKET_PATH` in our
   * own env, tempting as that is: the stale path lives in the ENGINE's
   * environment, which doctor cannot see, and our own override — when set —
   * IS this value (`defaultDaemonSocketPath()` returns it as its first
   * branch), so any such comparison is unreachable by construction.
   */
  readonly socketPath: string
  /**
   * Engine settings files whose hook install was refused (see
   * `engine/json-hooks.ts#parseHookSettings`). The SECOND way the channel
   * dies, and the one nothing used to diagnose: a stale socket at least
   * leaves live tabs behind, whereas a `hooks` shape Rove cannot parse means
   * the install never ran and nothing on the machine says so.
   */
  readonly configIssues?: readonly HookConfigIssue[]
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
  input: Pick<HookChannelInput, "socketPath" | "configIssues">,
  cliName: string,
): string[] {
  // A refused settings file is worth reporting whatever the tab verdict says:
  // one engine's hooks can be live while another's install has been skipped on
  // every launch since the file was hand-edited.
  const configLines = (input.configIssues ?? []).flatMap((issue) => [
    `         ⚠ hook install skipped: ${issue.file}`,
    `           ${issue.reason} — fix the file, then relaunch Rove`,
  ])
  if (verdict.kind === "no-tabs") return ["hooks:   — no engine tabs yet (nothing to check)", ...configLines]
  if (verdict.kind === "live") {
    return [
      `hooks:   ✓ engine hook channel live (${verdict.hookTabs}/${verdict.totalTabs} tab(s) hook-sourced)`,
      ...configLines,
    ]
  }
  const out = [
    `hooks:   ✗ NO hook events reaching the daemon (0/${verdict.totalTabs} tab(s) hook-sourced)`,
    "         badges fall back to a ~10s poll, so activity looks seconds late",
    `         daemon socket: ${input.socketPath}`,
    ...configLines,
  ]
  // The failure this names: an engine (and every hook it forks) inherits a
  // `*_DAEMON_SOCKET_PATH` pointing at a socket that is gone, so every hook
  // connects to nothing and drops its event without a word.
  // That env belongs to the engine process, not to doctor, so the hint
  // points at how to read it rather than pretending to check it here.
  out.push(
    `         → compare with an engine tab's own path: \`ps eww -p <engine-pid> | tr " " "\\n" | grep DAEMON_SOCKET_PATH\``,
    `         → restart the engine tabs (they may hold a stale socket path), or run \`${cliName} daemon restart\``,
    `         → debug one hook directly: \`KOBE_HOOK_DEBUG=1 echo '{}' | ${cliName} hook turn-start --engine claude\``,
  )
  return out
}
