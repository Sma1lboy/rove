/**
 * `kobe doctor --fix`: the diagnosis-to-remediation path.
 *
 * Every fix doctor knows is one of two kinds, and the kind IS the safety
 * contract:
 *
 * - `run` — safe to execute after a per-fix y/N confirmation: the action is
 *   reversible and never destroys state (a daemon restart — engine PTYs live
 *   in the separate host and survive it; an idempotent skill install).
 * - `manual` — doctor PRINTS the step but never executes it. Anything that
 *   kills live sessions (`kobe reset`, closing engine tabs), installs
 *   software, or logs in to an account lands here, and {@link applyFixes}
 *   has no code path that executes a manual fix.
 *
 * The criterion between the two: if the action went wrong, could the user
 * undo it themselves? No → `manual`.
 *
 * Each fix mirrors the remedy documented in `docs/TROUBLESHOOTING.md`; where
 * the documented fix is not runnable from here (engine logins, OS installs,
 * in-TUI tab restarts) it degrades to a printed pointer, so the two never
 * disagree.
 */

import { createInterface } from "node:readline"
import { t } from "../tui/i18n"

export type DoctorFix =
  | {
      readonly kind: "run"
      /** Stable identity — the same remedy proposed by two checks runs once. */
      readonly id: string
      readonly label: string
      /** The exact argv executed on confirmation; also what the user is shown. */
      readonly command: readonly string[]
      readonly why: string
    }
  | {
      readonly kind: "manual"
      readonly id: string
      readonly label: string
      /** The step the user performs — a command or an in-app action. Never executed. */
      readonly action: string
      readonly why: string
    }

type DaemonRestartReason = "daemonStale" | "daemonDown" | "hooksDown" | "inspectStale"

/** All daemon-shaped problems share one remedy — one id, so it runs once. */
export function daemonRestartFix(cliName: string, reason: DaemonRestartReason): DoctorFix {
  return {
    kind: "run",
    id: "daemon-restart",
    label: t(`doctor.fix.${reason}`),
    command: [cliName, "daemon", "restart"],
    why: t("doctor.fix.daemonRestartWhy"),
  }
}

/** `installCommand` is the space-joined wrapper command doctor already prints. */
export function skillInstallFix(installCommand: string, stale: boolean): DoctorFix {
  return {
    kind: "run",
    id: "skill-install",
    label: t(stale ? "doctor.fix.skillStale" : "doctor.fix.skillMissing"),
    command: installCommand.split(" "),
    why: t("doctor.fix.skillInstallWhy"),
  }
}

type ResetReason = "resetDaemonWedged" | "resetPty" | "resetLegacy"

/** `kobe reset` kills live sessions — always print-only, one entry per reason. */
export function resetManualFix(cliName: string, reason: ResetReason): DoctorFix {
  return {
    kind: "manual",
    id: `reset:${reason}`,
    label: t(`doctor.fix.${reason}`),
    action: `${cliName} reset`,
    why: t("doctor.fix.resetWhy"),
  }
}

/** The user-owned half of a dead hook channel: restarting the engine tabs. */
export function engineTabsManualFix(): DoctorFix {
  return {
    kind: "manual",
    id: "engine-tabs",
    label: t("doctor.fix.engineTabs"),
    action: t("doctor.fix.engineTabsAction"),
    why: t("doctor.fix.engineTabsWhy"),
  }
}

type HumanOnlyReason = "git" | "noEngine" | "windowsNode"

/** Installs and logins: doctor can only point, a human has to act. */
export function humanOnlyFix(reason: HumanOnlyReason): DoctorFix {
  return {
    kind: "manual",
    id: reason,
    label: t(`doctor.fix.${reason}`),
    action: t(`doctor.fix.${reason}Action`),
    why: t("doctor.fix.humanOnlyWhy"),
  }
}

/** Drop repeat proposals of the same remedy (first occurrence wins). */
export function dedupeFixes(fixes: readonly DoctorFix[]): DoctorFix[] {
  const seen = new Set<string>()
  return fixes.filter((fix) => {
    if (seen.has(fix.id)) return false
    seen.add(fix.id)
    return true
  })
}

/** Injected effects, so tests can prove what was (not) executed. */
export interface FixRuntime {
  /** Per-fix y/N gate. Only consulted for `run` fixes on an interactive terminal. */
  readonly confirm: (question: string) => Promise<boolean>
  /** Execute a confirmed `run` fix; resolves to its exit code. */
  readonly exec: (command: readonly string[]) => Promise<number>
  readonly out: (line: string) => void
  /** Without a TTY nothing is ever executed — the plan is printed instead. */
  readonly interactive: boolean
}

/**
 * Walk the collected fixes: runnable ones are shown (label, exact command,
 * why it is safe) and individually confirmed before executing; manual ones
 * are printed with the step and why doctor refuses to run it.
 */
export async function applyFixes(collected: readonly DoctorFix[], rt: FixRuntime): Promise<void> {
  const fixes = dedupeFixes(collected)
  if (fixes.length === 0) {
    rt.out("")
    rt.out(t("doctor.fix.none"))
    return
  }
  const runnable = fixes.filter((fix) => fix.kind === "run")
  if (runnable.length > 0) {
    rt.out("")
    rt.out(t("doctor.fix.header"))
    for (const fix of runnable) {
      rt.out(`  ${fix.label}`)
      rt.out(`    ${t("doctor.fix.willRun", { command: fix.command.join(" ") })}`)
      rt.out(`    ${fix.why}`)
      if (!rt.interactive) continue
      if (!(await rt.confirm(`    ${t("doctor.fix.confirmPrompt")}`))) {
        rt.out(`    ${t("doctor.fix.skipped")}`)
        continue
      }
      const code = await rt.exec(fix.command)
      rt.out(code === 0 ? `    ${t("doctor.fix.done")}` : `    ${t("doctor.fix.failed", { code })}`)
    }
    if (!rt.interactive) rt.out(`  ${t("doctor.fix.nonInteractive")}`)
  }
  const manual = fixes.filter((fix) => fix.kind === "manual")
  if (manual.length > 0) {
    rt.out("")
    rt.out(t("doctor.fix.manualHeader"))
    for (const fix of manual) {
      rt.out(`  ${fix.label}`)
      rt.out(`    → ${fix.action}`)
      rt.out(`    ${fix.why}`)
    }
  }
}

async function confirmTty(question: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolve) => readline.question(question, resolve))
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes"
  } finally {
    readline.close()
  }
}

async function execInherited(command: readonly string[]): Promise<number> {
  try {
    const proc = Bun.spawn([...command], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
    return await proc.exited
  } catch {
    return 127
  }
}

/** The real runtime: readline y/N, inherited-stdio spawn, console output. */
export function defaultFixRuntime(): FixRuntime {
  return {
    confirm: confirmTty,
    exec: execInherited,
    out: (line) => console.log(line),
    interactive: process.stdin.isTTY === true,
  }
}
