/**
 * `kobe doctor --fix`. The fix kind IS the safety contract:
 *
 * - `run` — executed after a per-fix y/N; reversible, never destroys state
 *   (daemon restart — engine PTYs survive in the host; idempotent installs).
 * - `manual` — printed, never executed: killing live sessions, installing
 *   software, logging in. {@link applyFixes} has no path that runs one.
 *
 * Criterion: if it went wrong, could the user undo it? No → `manual`.
 * Fixes mirror `docs/TROUBLESHOOTING.md`; unrunnable remedies print a pointer.
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

type ResetReason = "resetDaemonWedged" | "resetPty" | "resetPtyStale" | "resetLegacy"

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

/** Print-only: the list may hold a deliberately backgrounded process, and only
 *  the user can tell it from a leak. */
export function killOrphansManualFix(cliName: string, count: number): DoctorFix {
  return {
    kind: "manual",
    id: "kill-orphans",
    label: t("doctor.fix.orphans", { count }),
    action: `${cliName} doctor --kill-orphans`,
    why: t("doctor.fix.orphansWhy"),
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

/** Install deleted. Print-only: can't reinstall over the running process. */
export function reinstallManualFix(): DoctorFix {
  return {
    kind: "manual",
    id: "reinstall",
    label: t("doctor.fix.staleInstall"),
    action: t("doctor.fix.staleInstallAction"),
    why: t("doctor.fix.staleInstallWhy"),
  }
}

/** node-pty's spawn-helper lost its exec bit: chmod is idempotent and undoable. */
export function spawnHelperFix(paths: readonly string[]): DoctorFix {
  return {
    kind: "run",
    id: "spawn-helper-chmod",
    label: t("doctor.fix.spawnHelper"),
    command: ["chmod", "755", ...paths],
    why: t("doctor.fix.spawnHelperWhy"),
  }
}

type HumanOnlyReason = "git" | "noEngine" | "noEngineLogin" | "windowsNode" | "staleBun"

/** Installs and logins: doctor can only point, a human has to act. */
export function humanOnlyFix(reason: HumanOnlyReason, vars?: Record<string, string>): DoctorFix {
  return {
    kind: "manual",
    id: reason,
    label: t(`doctor.fix.${reason}`),
    action: t(`doctor.fix.${reason}Action`, vars),
    why: t("doctor.fix.humanOnlyWhy"),
  }
}

/** Nothing installed → install; CLI present but signed out → log in, naming them. */
export function noEngineFix(signedOut: readonly string[]): DoctorFix {
  return signedOut.length > 0 ? humanOnlyFix("noEngineLogin", { list: signedOut.join(", ") }) : humanOnlyFix("noEngine")
}

/** Just the remedy line, for surfaces that print prose rather than a fix list
 *  (the wizard's closing banner). Same branch, so the two cannot drift. */
export function noEngineAction(signedOut: readonly string[]): string {
  return signedOut.length > 0
    ? t("doctor.fix.noEngineLoginAction", { list: signedOut.join(", ") })
    : t("doctor.fix.noEngineAction")
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

/** Runnable fixes are shown and individually confirmed; manual ones only printed. */
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
