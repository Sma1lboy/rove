/**
 * A Windows Job Object around every hosted PTY session, so ending the session
 * ends EVERYTHING it started — Windows only; POSIX ends a session by signaling
 * its process group and never loads this module's launcher.
 *
 * `taskkill /T` (process-tree.ts) walks ParentProcessId, and Windows never
 * reparents: once a middle process exits, its children hang off a dead pid
 * that no walk reaches. An engine's Bash tool backgrounds a dev server from a
 * shell that then exits; `start /b` and `detached` + `unref` do the same. All
 * of those outlived `rove reset` and task delete.
 *
 * A job has no such hole: membership is inherited at CreateProcess, whatever
 * happens to the parent. node-pty can't create one and the node PTY host has
 * no FFI, so the PTY child is a tiny launcher (C#, compiled once by the
 * `csc.exe` every Windows 10/11 ships with .NET Framework 4) that
 *
 *   1. creates the job, named, with KILL_ON_JOB_CLOSE,
 *   2. puts ITSELF in it, then starts the real command line — so the shell and
 *      every descendant are members from their first instruction, no race,
 *   3. waits and exits with the shell's code. Its handle is the job's only
 *      one: however it dies — node-pty's `kill()`, `taskkill`, the console
 *      closing — the kernel closes the handle and kills the whole job.
 *
 * No BREAKAWAY_OK: with it, node's `spawn({ detached: true })` leaves the job
 * (measured), the commonest way an agent backgrounds a server. Breakaway in a
 * job hierarchy leaves every job that allows it and stops at the first that
 * doesn't (measured), so Rove's detached launcher (win-detached-launch.ts)
 * run from a tab still leaves Bun's kill-on-exit job — and lands in the TAB'S.
 * For a NESTED Rove (another instance — a `dev:sandbox` an agent started)
 * that is the point: it ends with the tab. The SAME instance's daemon must
 * outlive the tab (an agent's `rove daemon restart`), and nothing inside a
 * job can widen it (ACCESS_DENIED, measured), so that launch is handed to the
 * tab's own PTY host — outside every tab job — via `spawn.detached`. See
 * {@link ptyJobLaunch}.
 *
 * Any failure (no csc, compile error, self-test fails) leaves the launcher
 * unused: the session runs exactly as before, with taskkill alone.
 */

import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

/** The tab's job name, set in the PTY child's environment. */
export const PTY_JOB_ENV = "ROVE_PTY_JOB"
/** Daemon socket of the Rove instance that owns that job (its identity). */
export const PTY_JOB_OWNER_ENV = "ROVE_PTY_JOB_OWNER"

/**
 * The launcher. argv: `<exe> <command line…>`; everything after its own path
 * is passed to CreateProcess VERBATIM (node-pty already quoted it). The job's
 * name comes from {@link PTY_JOB_ENV}, not argv: the first prompt can ride
 * the command line, and every character here is one it loses (measured
 * 32686 → 32461 with the name in argv). Ctrl+C / Ctrl+Break reach every
 * console process: the launcher swallows them with a handler (inherited by
 * nobody) so only the shell and its children see the interrupt. Without a
 * name, or a job it cannot create or join, it still runs the command.
 */
export const PTY_JOB_LAUNCHER_CS = `
using System;
using System.Runtime.InteropServices;
using System.Text;
static class RovePtyJob {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong R, W, O, RB, WB, OB; }
  [StructLayout(LayoutKind.Sequential)] struct EXT { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  delegate bool CtrlHandler(uint type);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, int len);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetCommandLine();
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(CtrlHandler h, bool add);
  static CtrlHandler keep;
  static int SkipToken(string s, int i) {
    if (i < s.Length && s[i] == '"') { int end = s.IndexOf('"', i + 1); return end < 0 ? s.Length : end + 1; }
    while (i < s.Length && s[i] != ' ' && s[i] != '\\t') i++;
    return i;
  }
  static int SkipSpace(string s, int i) { while (i < s.Length && (s[i] == ' ' || s[i] == '\\t')) i++; return i; }
  static int Main() {
    string raw = Marshal.PtrToStringUni(GetCommandLine());
    string rest = raw.Substring(SkipSpace(raw, SkipToken(raw, 0)));
    if (rest.Length == 0) { Console.Error.WriteLine("rove-pty-job: usage: <command line> (job name in ${PTY_JOB_ENV})"); return 2; }
    string name = Environment.GetEnvironmentVariable("${PTY_JOB_ENV}");
    IntPtr job = String.IsNullOrEmpty(name) ? IntPtr.Zero : CreateJobObject(IntPtr.Zero, name);
    if (job != IntPtr.Zero) {
      EXT info = new EXT();
      info.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE; no BREAKAWAY_OK (see module doc)
      SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(EXT)));
      AssignProcessToJobObject(job, GetCurrentProcess());
    }
    keep = delegate (uint type) { return type <= 1; }; // CTRL_C, CTRL_BREAK: the shell's to handle
    SetConsoleCtrlHandler(keep, true);
    SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI));
    PI pi;
    if (!CreateProcess(null, new StringBuilder(rest), IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi)) {
      Console.Error.WriteLine("rove-pty-job: could not start " + rest + " (error " + Marshal.GetLastWin32Error() + ")");
      return 1;
    }
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(pi.hProcess, out code);
    GC.KeepAlive(keep);
    return (int)code;
  }
}
`

/** csc answers in ~1s; a wedged one must not hold the PTY host's boot. */
const COMPILE_TIMEOUT_MS = 30_000
const SELF_TEST_TIMEOUT_MS = 10_000
const SELF_TEST_EXIT_CODE = 7

/**
 * Never rejects or throws: a file Windows refuses to run (truncated,
 * quarantined) makes `execFile` throw SYNCHRONOUSLY (`EUNKNOWN`, measured),
 * which would otherwise take the PTY host's boot down with it.
 */
function run(
  file: string,
  args: readonly string[],
  timeout: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number | null; output: string }> {
  return new Promise((done) => {
    try {
      const child = execFile(file, [...args], { windowsHide: true, timeout, env }, (err, stdout, stderr) => {
        const output = `${stdout}${stderr}`.trim() || err?.message || ""
        done({ code: child.exitCode, output })
      })
    } catch (err) {
      done({ code: null, output: (err as Error).message })
    }
  })
}

/** .NET Framework 4's compiler, present on every supported Windows. */
export function findCsc(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = env.SystemRoot || env.windir || "C:\\Windows"
  for (const framework of ["Framework64", "Framework"]) {
    const csc = join(root, "Microsoft.NET", framework, "v4.0.30319", "csc.exe")
    if (existsSync(csc)) return csc
  }
  return null
}

/** Content-addressed, so an upgraded launcher never reuses a stale build. */
export function launcherFileName(source: string = PTY_JOB_LAUNCHER_CS): string {
  return `rove-pty-job-${createHash("sha256").update(source).digest("hex").slice(0, 12)}.exe`
}

/** A fresh job name; one per session, never reused. */
export function newPtyJobName(): string {
  return `Local\\rove-pty-${randomUUID()}`
}

export type PtyJobLauncher =
  | { readonly path: string; readonly reason?: undefined }
  | { readonly path: null; readonly reason: string }

/** Compile into `exe`; the failure, or null. */
async function compileLauncher(binDir: string, exe: string): Promise<string | null> {
  const csc = findCsc()
  if (!csc) return "no .NET Framework csc.exe"
  mkdirSync(binDir, { recursive: true })
  const tag = `${process.pid}-${randomUUID().slice(0, 8)}`
  const src = join(binDir, `rove-pty-job-${tag}.cs`)
  const tmp = join(binDir, `rove-pty-job-${tag}.exe`)
  try {
    writeFileSync(src, PTY_JOB_LAUNCHER_CS)
    const built = await run(csc, ["/nologo", "/target:exe", "/optimize+", `/out:${tmp}`, src], COMPILE_TIMEOUT_MS)
    if (built.code !== 0 || !existsSync(tmp)) return `csc failed: ${built.output}`
    try {
      renameSync(tmp, exe)
    } catch (err) {
      // A concurrent host won the rename; its build is identical.
      if (!existsSync(exe)) return `could not place ${exe}: ${(err as Error).message}`
    }
    return null
  } finally {
    rmSync(src, { force: true })
    rmSync(tmp, { force: true })
  }
}

/** Run `cmd /c exit 7` through the launcher in a throwaway job; the failure, or null. */
async function selfTest(exe: string): Promise<string | null> {
  const comspec = process.env.ComSpec || "cmd.exe"
  const probe = await run(exe, [comspec, "/d", "/c", `exit ${SELF_TEST_EXIT_CODE}`], SELF_TEST_TIMEOUT_MS, {
    ...process.env,
    [PTY_JOB_ENV]: newPtyJobName(),
  })
  return probe.code === SELF_TEST_EXIT_CODE ? null : `self-test exited ${probe.code}: ${probe.output}`
}

/**
 * The launcher exe in `binDir`, compiled on first use and proven by the
 * self-test. A cached build that fails it (truncated, quarantined) is rebuilt
 * once, not trusted forever. Never throws: `path: null` (with why) means
 * "don't wrap" — sessions then run exactly as before.
 */
export async function ensurePtyJobLauncher(binDir: string): Promise<PtyJobLauncher> {
  try {
    const exe = join(binDir, launcherFileName())
    let cachedFailure: string | null = null
    if (existsSync(exe)) {
      cachedFailure = await selfTest(exe)
      if (cachedFailure === null) return { path: exe }
      rmSync(exe, { force: true })
    }
    const compileFailure = await compileLauncher(binDir, exe)
    if (compileFailure) return { path: null, reason: compileFailure }
    const failure = await selfTest(exe)
    if (failure === null) return { path: exe }
    return { path: null, reason: cachedFailure ? `${failure} (rebuilt after: ${cachedFailure})` : failure }
  } catch (err) {
    return { path: null, reason: `launcher setup failed: ${(err as Error).message}` }
  }
}

/** Same address, however each side spelled it. */
function sameSocket(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p.replace(/\//g, "\\")).toLowerCase()
  return norm(a) === norm(b)
}

/** How a detached launch from inside a session's job treats that job. */
export interface PtyJobLaunch {
  readonly job: string
  /** `escape`: outlive the tab, via its PTY host. `join`: stay in the tab's job (the launcher's default there). */
  readonly mode: "escape" | "join"
}

/** The env a child that outlives the tab gets: no claim on a job it left. */
export function withoutPtyJob(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  delete out[PTY_JOB_ENV]
  delete out[PTY_JOB_OWNER_ENV]
  return out
}

/**
 * Launched from inside a hosted session (`env` carries its job), a daemon or
 * PTY host of the SAME Rove instance — same daemon socket — must outlive the
 * tab, as it always has. One of ANOTHER instance (a nested sandbox) belongs to
 * the tab: it joins the job, and dies with the session that started it.
 * Null outside any session: the launch is what it always was.
 */
export function ptyJobLaunch(env: NodeJS.ProcessEnv, ownDaemonSocket: string): PtyJobLaunch | null {
  const job = env[PTY_JOB_ENV]
  const owner = env[PTY_JOB_OWNER_ENV]
  if (!job || !owner) return null
  return { job, mode: sameSocket(owner, ownDaemonSocket) ? "escape" : "join" }
}
