/**
 * Doctor check: is the ENGINE HOOK CHANNEL live?
 *
 * `kobe hook` is best-effort (never spawns a daemon, always exits 0, swallows
 * failures) and the observer falls back to a ~10s poll, so a dead channel looks
 * slow, not broken. Usual cause: an engine's inherited `*_DAEMON_SOCKET_PATH`
 * points at a dead socket.
 *
 * `debug.inspect` records each tab entry's source (`hook` vs `observed`); tabs
 * with ZERO hook-sourced entries = channel down. A plain read, no probe. Only
 * "no hook events at all" is reported: a tab idle since daemon start has no
 * hook entry yet and is healthy.
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
   * The socket this CLI resolved, echoed for the reader to compare. Not checked
   * against our own `*_DAEMON_SOCKET_PATH`: the stale path is in the ENGINE's
   * env, and ours, when set, IS this value (`defaultDaemonSocketPath()`).
   */
  readonly socketPath: string
  /**
   * Settings files whose hook install was refused
   * (`engine/json-hooks.ts#parseHookSettings`): an unparseable `hooks` shape
   * means the install never ran, silently.
   */
  readonly configIssues?: readonly HookConfigIssue[]
}

export type HookChannelVerdict =
  | { readonly kind: "no-tabs" }
  | { readonly kind: "live"; readonly hookTabs: number; readonly totalTabs: number }
  | { readonly kind: "down"; readonly totalTabs: number }

/** Pure. No tabs at all is `no-tabs` (nothing to conclude), not `down`. */
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

/** `cliName` is whichever name the user invoked (`rove` / `kobe`). */
export function hookChannelDoctorLines(
  verdict: HookChannelVerdict,
  input: Pick<HookChannelInput, "socketPath" | "configIssues">,
  cliName: string,
): string[] {
  // Reported under any verdict: one engine's hooks can be live while another's are skipped.
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
  // The stale path lives in the engine's env, which doctor can't read; the hint
  // shows how to read it.
  out.push(
    `         → compare with an engine tab's own path: \`ps eww -p <engine-pid> | tr " " "\\n" | grep DAEMON_SOCKET_PATH\``,
    `         → restart the engine tabs (they may hold a stale socket path), or run \`${cliName} daemon restart\``,
    `         → debug one hook directly: \`KOBE_HOOK_DEBUG=1 echo '{}' | ${cliName} hook turn-start --engine claude\``,
  )
  return out
}
