/**
 * How a background child escapes its parent on Windows.
 *
 * `spawnDetachedDaemon` (daemon-process.ts) spawns the daemon and the PTY
 * host as children that must OUTLIVE the process that started them — the
 * TUI, a `rove daemon restart`, an agent's `rove api` call. On POSIX
 * `detached: true` (setsid) is the whole answer. On Windows, under Bun,
 * two things kill such a child that no spawn option can prevent:
 *
 *  1. **Bun puts every child in a job object with KILL_ON_JOB_CLOSE.** The
 *     moment the spawning Bun process exits, the job closes and every
 *     process in it is terminated — `unref()`, `detached: true`, and
 *     `windowsHide` change nothing. The job does allow breakaway
 *     (`BREAKAWAY_OK | SILENT_BREAKAWAY_OK`), so a process created with
 *     `CREATE_BREAKAWAY_FROM_JOB` is spared.
 *  2. **`windowsHide` is dropped when stdio carries file handles.** With
 *     `stdio: ["ignore", logFd, logFd]` the child lands on the PARENT'S
 *     console instead of a hidden one of its own, and a console close /
 *     Ctrl+C on the terminal running the TUI ends every process attached
 *     to it — the PTY host included, which is how "quit Rove and every
 *     engine tab died with it" happened on Windows while macOS kept them.
 *
 * Neither flag is reachable through `child_process`, so the child is
 * created by a small PowerShell launcher that calls `CreateProcess`
 * directly: `CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_CONSOLE` with the
 * window hidden, and stdout/stderr pointed at the log file with an
 * inheritable append handle — the same "append fd" contract the log
 * rotation in daemon-cmd.ts / pty-host-cmd.ts relies on. The launcher's own
 * parameters travel in environment variables (never on a command line, so
 * there is nothing to quote twice) and are removed before the child is
 * created, so the daemon does not inherit them.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

/** The launcher reads these; it strips them before the child is created. */
export const LAUNCH_CMD_ENV = "ROVE_LAUNCH_CMD"
export const LAUNCH_LOG_ENV = "ROVE_LAUNCH_LOG"

/**
 * The launcher. Plain Windows PowerShell 5.1 (always present) plus one
 * `Add-Type` for the three kernel32 calls. Exit code 1 with the error on
 * stderr when the child could not be created, so the caller can fall back.
 */
export const WIN_DETACHED_LAUNCHER_PS = `
$ErrorActionPreference = 'Stop'
$cmd = $env:${LAUNCH_CMD_ENV}
$log = $env:${LAUNCH_LOG_ENV}
if (-not $cmd -or -not $log) { [Console]::Error.WriteLine('rove launcher: ${LAUNCH_CMD_ENV}/${LAUNCH_LOG_ENV} not set'); exit 1 }
Remove-Item Env:${LAUNCH_CMD_ENV}, Env:${LAUNCH_LOG_ENV}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RoveDetachedLaunch {
  [StructLayout(LayoutKind.Sequential)] public struct SA { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct SI { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name, uint access, uint share, ref SA sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Launch(string cmd, string log) {
    SA sa = new SA(); sa.nLength = Marshal.SizeOf(sa); sa.bInheritHandle = true;
    // FILE_APPEND_DATA | GENERIC_READ, shared read/write, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL
    IntPtr h = CreateFile(log, 0x0004 | 0x80000000, 0x1 | 0x2, ref sa, 4, 0x80, IntPtr.Zero);
    if (h == (IntPtr)(-1)) throw new Exception("CreateFile(" + log + ") failed: " + Marshal.GetLastWin32Error());
    IntPtr nul = CreateFile("NUL", 0x80000000, 0x1 | 0x2, ref sa, 3, 0x80, IntPtr.Zero);
    SI si = new SI(); si.cb = Marshal.SizeOf(si);
    si.dwFlags = 0x100 | 0x1; // STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW
    si.wShowWindow = 0;       // SW_HIDE
    si.hStdInput = nul; si.hStdOutput = h; si.hStdError = h;
    PI pi;
    uint flags = 0x00000010 | 0x01000000 | 0x00000200; // CREATE_NEW_CONSOLE | CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi)) throw new Exception("CreateProcess failed: " + Marshal.GetLastWin32Error());
    CloseHandle(h); CloseHandle(nul); CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return pi.dwProcessId;
  }
}
'@
[RoveDetachedLaunch]::Launch($cmd, $log) | Out-Null
`

/**
 * One argv rendered as the command line `CreateProcess` hands the child —
 * the quoting MSVCRT's argv parser undoes: an argument with a space, tab or
 * quote is wrapped in quotes, a quote inside is escaped, and backslashes
 * are doubled ONLY where they precede a quote (a trailing run before the
 * closing quote included). A plain path with backslashes passes verbatim.
 */
export function windowsCommandLine(argv: readonly string[]): string {
  return argv.map(quoteWindowsArg).join(" ")
}

function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let backslashes = 0
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++
      continue
    }
    if (ch === '"') {
      out += `${"\\".repeat(backslashes * 2 + 1)}"`
      backslashes = 0
      continue
    }
    out += "\\".repeat(backslashes) + ch
    backslashes = 0
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`
}

/** `powershell.exe` by absolute path — PATH is not guaranteed under a PTY. */
export function windowsPowershellPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot || env.windir || "C:\\Windows"
  const absolute = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  return existsSync(absolute) ? absolute : "powershell.exe"
}

/** PowerShell's `-EncodedCommand` wants the script as base64 UTF-16LE. */
export function encodePowershellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64")
}

/** The launcher's argv, for callers and tests that inspect the spawn. */
export function windowsDetachedLauncherArgs(): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodePowershellCommand(WIN_DETACHED_LAUNCHER_PS),
  ]
}

/**
 * Spawn `command args` on Windows so that it outlives this process and its
 * console, with stdout/stderr appended to `logPath`. Returns the LAUNCHER
 * child: it exits 0 once the real child exists, non-zero when it could not
 * be created — the caller decides what to do then.
 *
 * The launcher itself gets `windowsHide` + `stdio: "ignore"`, the one
 * combination Bun honours; the real child never sees the launcher's
 * console anyway (it gets its own), and never sees `LAUNCH_*` (stripped).
 */
export function spawnWindowsDetached(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  spawnImpl: typeof spawn = spawn,
): ChildProcess {
  const child = spawnImpl(windowsPowershellPath(env), windowsDetachedLauncherArgs(), {
    windowsHide: true,
    stdio: "ignore",
    env: { ...env, [LAUNCH_CMD_ENV]: windowsCommandLine([command, ...args]), [LAUNCH_LOG_ENV]: logPath },
  })
  child.unref()
  return child
}
