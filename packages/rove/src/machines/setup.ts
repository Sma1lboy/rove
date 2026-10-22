/**
 * Guided machine setup: probe, and on failure offer the fix instead of
 * exiting. Same safety contract as `rove doctor --fix` (`cli/doctor-fix.ts`):
 *
 * - `run` — local and reversible (a dedicated key under `~/.rove/ssh/`, one
 *   `authorized_keys` line on the machine). Shown, confirmed per fix.
 * - `install` — installs software on the machine. Shown and confirmed like
 *   `run`, but only ever offered inside a setup the user started, never by
 *   `doctor --fix`.
 * - `manual` — printed, never executed.
 *
 * Every fix states the exact argv it runs; nothing edits `~/.ssh/config` or a
 * shell rc file.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { homeDir } from "../env.ts"
import { shQuote } from "../exec/exec-host.ts"
import { type DiscoverFailure, type DiscoverResult, discoverMachine, remoteRove } from "./discover.ts"
import { type MachineConfig, sshTargetOf } from "./registry.ts"
import { machineSshArgs } from "./ssh-args.ts"

export type SetupFix =
  | {
      readonly kind: "run" | "install"
      readonly id: string
      readonly label: string
      /** What the user is shown: the argv, readable. */
      readonly shown: string
      readonly why: string
      /** Built when the fix runs: it may read a key an earlier fix created. */
      argv(): readonly string[]
      /** The config the next probe uses once this fix succeeded. */
      readonly apply?: (config: MachineConfig) => MachineConfig
    }
  | { readonly kind: "manual"; readonly id: string; readonly label: string; readonly action: string }

/** The key a hub logs in with: one per hub, so revoking a hub is one line. */
export function hubKeyPath(home = homeDir()): string {
  return join(home, ".rove", "ssh", "hub_ed25519")
}

export const INSTALL_SCRIPT = "curl -fsSL https://rove.run/install.sh | sh"

/** What a failed probe can be fixed with, most direct first. */
export function fixesFor(
  failure: DiscoverFailure,
  alias: string,
  config: MachineConfig,
  keyPath = hubKeyPath(),
): SetupFix[] {
  const target = sshTargetOf(config)
  const ssh = (cmd: string, batch = true): string[] => [...machineSshArgs(alias, config, { batch }), cmd]
  if (failure.code === "SSH_FAILED" && failure.ssh === "auth-denied" && config.auth.kind === "key") {
    const fixes: SetupFix[] = []
    if (!existsSync(keyPath)) {
      fixes.push({
        kind: "run",
        id: "hub-key",
        label: "Create a key this hub logs in with",
        shown: `ssh-keygen -t ed25519 -N "" -C ${hubKeyComment()} -f ${keyPath}`,
        why: "A dedicated key revokes this hub alone: delete its one line on the machine. No passphrase, so the hub can reconnect unattended; the file is owner-only.",
        argv: () => {
          mkdirSync(join(keyPath, ".."), { recursive: true, mode: 0o700 })
          return ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", hubKeyComment(), "-f", keyPath]
        },
      })
    }
    fixes.push({
      kind: "run",
      id: "install-hub-key",
      label: `Authorize that key on ${target}`,
      shown: `ssh ${target} 'append ${keyPath}.pub to ~/.ssh/authorized_keys'`,
      why: "The one interactive step: ssh asks for your password on that machine once. Rove never sees it.",
      argv: () => ssh(authorizeKeyScript(readFileSync(`${keyPath}.pub`, "utf8").trim()), false),
      apply: (c) => ({ ...c, auth: { kind: "key", keyPath } }),
    })
    return fixes
  }
  // The failure's own message already names the cause and the remedy.
  if (failure.code === "SSH_FAILED") return []
  if (failure.code === "NO_ROVE") {
    return [
      {
        kind: "install",
        id: "install-rove",
        label: `Install Rove on ${target}`,
        shown: `ssh ${target} '${INSTALL_SCRIPT}'`,
        why: "The official install script: sets up Bun if needed, then Rove, for that user only.",
        argv: () => ssh(INSTALL_SCRIPT),
      },
    ]
  }
  if (failure.code === "BAD_STATUS" && /too old/.test(failure.message)) {
    return [
      {
        kind: "install",
        id: "update-rove",
        label: `Update Rove on ${target}`,
        shown: `ssh ${target} 'rove update'`,
        why: "Its Rove predates machines; `rove update` moves it to the current release.",
        argv: () => ssh(remoteRove(config.roveBin, ["update"])),
      },
    ]
  }
  return [
    {
      kind: "manual",
      id: "daemon-log",
      label: `Rove on ${target} would not start its daemon`,
      action: `ssh ${target} 'tail -n 40 ~/.rove/daemon.log'`,
    },
  ]
}

function hubKeyComment(): string {
  return `rove-hub@${hostname()}`
}

/** Idempotent append with owner-only modes; `grep -qxF` keeps a re-run from duplicating the line. */
export function authorizeKeyScript(publicKey: string): string {
  const line = shQuote(publicKey)
  return [
    "umask 077",
    "mkdir -p ~/.ssh",
    "touch ~/.ssh/authorized_keys",
    `grep -qxF ${line} ~/.ssh/authorized_keys || printf '%s\\n' ${line} >> ~/.ssh/authorized_keys`,
  ].join(" && ")
}

export interface SetupRuntime {
  readonly confirm: (question: string) => Promise<boolean>
  readonly exec: (argv: readonly string[]) => Promise<number>
  readonly out: (line: string) => void
  /** Ask before each fix. False with `--yes`. */
  readonly ask: boolean
  /** No terminal and no `--yes`: print the plan, run nothing. */
  readonly planOnly: boolean
  readonly discover?: typeof discoverMachine
}

export type SetupOutcome =
  | { readonly ok: true; readonly found: DiscoverResult; readonly config: MachineConfig }
  | { readonly ok: false; readonly failure: DiscoverFailure }

/**
 * Probe, fix, probe again — until the machine answers, a fix is declined or
 * fails, or only manual steps remain. A failure that survives its own fix
 * stops the loop instead of offering the same fix forever.
 */
export async function establishMachine(alias: string, initial: MachineConfig, rt: SetupRuntime): Promise<SetupOutcome> {
  const discover = rt.discover ?? discoverMachine
  let config = initial
  const tried = new Set<string>()
  for (;;) {
    const found = await discover(alias, config)
    if (found.ok) return { ok: true, found, config: found.roveBin ? { ...config, roveBin: found.roveBin } : config }
    rt.out(found.message)
    const fixes = fixesFor(found, alias, config)
    const runnable = fixes.filter((f) => f.kind !== "manual" && !tried.has(f.id))
    for (const fix of fixes) {
      if (fix.kind === "manual") rt.out(`  → ${fix.action}`)
    }
    if (runnable.length === 0) return { ok: false, failure: found }
    for (const fix of runnable) {
      if (fix.kind === "manual") continue
      tried.add(fix.id)
      rt.out(`  ${fix.label}`)
      rt.out(`    will run: ${fix.shown}`)
      rt.out(`    ${fix.why}`)
      if (rt.planOnly) continue
      if (rt.ask && !(await rt.confirm("    Run it? [y/N] "))) return { ok: false, failure: found }
      const code = await rt.exec(fix.argv())
      if (code !== 0) {
        rt.out(`    failed (exit ${code})`)
        return { ok: false, failure: found }
      }
      if (fix.apply) config = fix.apply(config)
    }
    if (rt.planOnly) {
      rt.out("  Not a terminal: nothing was run. Re-run in a terminal, or pass --yes.")
      return { ok: false, failure: found }
    }
  }
}
