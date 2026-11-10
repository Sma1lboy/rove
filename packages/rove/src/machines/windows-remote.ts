/**
 * A machine running native Windows Rove, as a hub sees it. Its sshd runs the
 * command in cmd or PowerShell (the `DefaultShell`), not sh; its daemon socket
 * has a drive letter and its PTY host is a named pipe, neither of which ssh can
 * forward, so every connection is relayed (`stdio-forward.ts`).
 *
 * Pure: nothing here spawns, so the logic is tested on every OS.
 */

/** `C:\…`, `C:/…`, or a `\\.\pipe\…` / `\\?\…` device path. */
export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[.?]\\/.test(path)
}

/** Known from the socket paths its daemon reported, or from where its `rove` was found. */
export function isWindowsMachine(config: {
  readonly sockets?: { readonly daemon: string; readonly pty: string }
  readonly roveBin?: string
}): boolean {
  if (config.sockets && (isWindowsPath(config.sockets.daemon) || isWindowsPath(config.sockets.pty))) return true
  return config.roveBin !== undefined && isWindowsPath(config.roveBin)
}

/** A PowerShell single-quoted literal: nothing inside expands. */
export function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * A script run by Windows PowerShell 5.1 (present on every Windows), as one
 * command line that cmd, pwsh and powershell all pass through unchanged:
 * base64 has nothing for any of them to quote or expand. `-NoProfile` keeps the
 * user's profile out of it; the session's own `DefaultShell` still runs its
 * profile first (see {@link RELAY_PREAMBLE} in `relay-preamble.ts`).
 */
export function powershellCommand(script: string): string {
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`
}

/** Run Rove at an absolute Windows path, whatever the session's shell. Its exit code is the command's. */
export function windowsRoveCommand(roveBin: string, args: readonly string[]): string {
  return powershellCommand(`& ${psQuote(roveBin)} ${args.map(psQuote).join(" ")}; exit $LASTEXITCODE`)
}

/**
 * Where a Windows install puts `rove`, for a session whose PATH lacks it. The
 * user PATH is read from the registry too: an install made after sshd started
 * may not be in the session's copy yet.
 */
const WINDOWS_LOCATE_SCRIPT = [
  '$dirs = @("$env:APPDATA\\npm", "$env:USERPROFILE\\.bun\\bin", "$env:LOCALAPPDATA\\pnpm", $env:NVM_SYMLINK)',
  "$dirs += [Environment]::GetEnvironmentVariable('Path', 'User') -split ';'",
  "foreach ($d in $dirs) { if (-not $d) { continue }",
  "  foreach ($n in 'rove.cmd', 'rove.exe') { $p = Join-Path $d $n; if (Test-Path -LiteralPath $p) { \"ROVE_BIN=$p\"; exit 0 } } }",
  "exit 1",
].join("\n")

export const WINDOWS_LOCATE_ROVE = powershellCommand(WINDOWS_LOCATE_SCRIPT)

/** cmd's and PowerShell's "no such command" for `rove`, or for a stale absolute `rove.cmd`. */
export const WINDOWS_ROVE_MISSING =
  /'(?:[^'\r\n]*[\\/])?rove(?:\.cmd|\.exe|\.ps1)?' is not recognized as (?:an internal or external command|(?:the|a) name of a cmdlet)/i

/** Windows PowerShell's default execution policy refusing npm's `rove.ps1` shim. */
export const WINDOWS_SCRIPTS_DISABLED = /rove\.ps1 cannot be loaded because running scripts is disabled/i

/** `rove` missing from a Windows machine's ssh sessions: what to run there. */
export function windowsNoRoveMessage(alias: string, output: string): string {
  if (WINDOWS_SCRIPTS_DISABLED.test(output)) {
    return [
      `${alias}'s ssh sessions run Windows PowerShell, whose execution policy refuses npm's rove.ps1, and no rove.cmd was found to use instead.`,
      `On ${alias}, either allow scripts for your user: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`,
      `or make ssh use PowerShell 7 (elevated): New-ItemProperty -Path HKLM:\\SOFTWARE\\OpenSSH -Name DefaultShell -Value "$env:ProgramFiles\\PowerShell\\7\\pwsh.exe" -PropertyType String -Force`,
    ].join("\n")
  }
  return [
    `Rove is not on the PATH of ssh sessions on ${alias} (Windows), nor in %APPDATA%\\npm, ~\\.bun\\bin or the user PATH.`,
    "Install it there in a PowerShell: npm install -g @sma1lboy/rove",
    `If it is installed elsewhere, add that folder to your user PATH on ${alias}, then restart sshd (elevated: Restart-Service sshd) so new sessions see it.`,
  ].join("\n")
}

/** `ssh -v`'s line naming the server software, before any authentication. */
export const WINDOWS_SSHD_BANNER = /remote software version OpenSSH_for_Windows/i

/** The OpenSSH Server steps on a Windows machine, each line runnable in an elevated PowerShell there. */
export const WINDOWS_SSHD_STEPS: readonly string[] = [
  "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0",
  "Set-Service sshd -StartupType Automatic; Start-Service sshd",
  "if (-not (Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name OpenSSH-Server-In-TCP -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 }",
]

/**
 * Authorizing a hub's key on a Windows machine, printed for the user to run
 * there: OpenSSH for Windows reads an administrator's keys from
 * `%ProgramData%\ssh\administrators_authorized_keys` (writable only elevated,
 * and ignored unless only SYSTEM and Administrators can read it), everyone
 * else's from `~\.ssh\authorized_keys`.
 */
export function windowsAuthorizeKeySteps(publicKey: string): readonly string[] {
  const key = psQuote(publicKey.trim())
  return [
    "# Administrator account (elevated PowerShell):",
    `Add-Content -Path "$env:ProgramData\\ssh\\administrators_authorized_keys" -Value ${key}`,
    `icacls.exe "$env:ProgramData\\ssh\\administrators_authorized_keys" /inheritance:r /grant "*S-1-5-32-544:F" /grant "SYSTEM:F"`,
    "# Standard account (normal PowerShell):",
    `New-Item -ItemType Directory -Force "$HOME\\.ssh" | Out-Null; Add-Content -Path "$HOME\\.ssh\\authorized_keys" -Value ${key}`,
  ]
}
