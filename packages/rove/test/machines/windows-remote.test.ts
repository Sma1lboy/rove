import { describe, expect, test } from "vitest"
import { parseLocatedRove, parseStatusJson, remoteRove } from "../../src/machines/discover.ts"
import { relayCommand, useStdioTransport } from "../../src/machines/stdio-forward.ts"
import {
  WINDOWS_LOCATE_ROVE,
  WINDOWS_ROVE_MISSING,
  WINDOWS_SCRIPTS_DISABLED,
  isWindowsMachine,
  windowsNoRoveMessage,
} from "../../src/machines/windows-remote.ts"

/** What `powershell -EncodedCommand` will run. */
function decoded(command: string): string {
  const b64 = command.split(" ").at(-1) ?? ""
  return Buffer.from(b64, "base64").toString("utf16le")
}

// Verbatim from a native Windows Rove's `rove daemon status --json`.
const WINDOWS_STATUS = JSON.stringify({
  daemonPid: 38716,
  roveVersion: "0.9.266",
  homeDir: "C:\\Users\\jackson",
  socketPath: "C:\\Users\\jackson\\.rove\\daemon.sock",
  ptySocketPath: "\\\\.\\pipe\\rove-2b625602-pty",
  hostname: "sma1lboy",
  relayPreamble: true,
})

describe("a native Windows machine", () => {
  test("is recognized by the sockets its daemon reports, which ssh cannot forward, so it relays from any hub", () => {
    const status = parseStatusJson(WINDOWS_STATUS)
    expect(status).not.toBeNull()
    const sockets = { daemon: status?.socketPath ?? "", pty: status?.ptySocketPath ?? "" }
    expect(isWindowsMachine({ sockets })).toBe(true)
    expect(useStdioTransport("darwin", { sockets })).toBe(true)
    expect(isWindowsMachine({ sockets: { daemon: "/home/n/.rove/daemon.sock", pty: "/home/n/.rove/pty.sock" } })).toBe(
      false,
    )
  })

  test("reads the version a pre-rename daemon reports", () => {
    const old = WINDOWS_STATUS.replace('"roveVersion"', '"kobeVersion"').replace(',"relayPreamble":true', "")
    expect(parseStatusJson(old)).toMatchObject({ roveVersion: "0.9.266", relayPreamble: false })
  })

  test("asks for a preamble only from a rove that offers one", () => {
    expect(relayCommand({ relayPreamble: true }, true)).toBe("rove daemon relay --pty --preamble")
    expect(relayCommand({}, false)).toBe("rove daemon relay")
  })

  test("runs a located rove through PowerShell, whatever shell sshd starts", () => {
    const bin = "C:\\Users\\O'Neil Smith\\AppData\\Roaming\\npm\\rove.cmd"
    const command = relayCommand({ roveBin: bin, relayPreamble: true }, true)
    // Base64 carries nothing cmd, pwsh or sh would quote or expand.
    expect(command).toMatch(
      /^powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/,
    )
    expect(decoded(command)).toBe(
      "& 'C:\\Users\\O''Neil Smith\\AppData\\Roaming\\npm\\rove.cmd' 'daemon' 'relay' '--pty' '--preamble'; exit $LASTEXITCODE",
    )
    expect(remoteRove("/home/n/.bun/bin/rove", ["update"])).toBe(
      `PATH='/home/n/.bun/bin':"$PATH" '/home/n/.bun/bin/rove' update`,
    )
  })

  test("takes the located rove from the locate script's output", () => {
    expect(parseLocatedRove("fastfetch noise\r\nROVE_BIN=C:\\Users\\j\\AppData\\Roaming\\npm\\rove.cmd\r\n")).toBe(
      "C:\\Users\\j\\AppData\\Roaming\\npm\\rove.cmd",
    )
    expect(decoded(WINDOWS_LOCATE_ROVE)).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')")
  })
})

describe("rove missing from a Windows ssh session", () => {
  // Each verbatim from that shell.
  const CMD = "'rove' is not recognized as an internal or external command,\r\noperable program or batch file."
  const PWSH =
    "rove: The term 'rove' is not recognized as a name of a cmdlet, function, script file, or executable program."
  const POWERSHELL =
    "rove : The term 'rove' is not recognized as the name of a cmdlet, function, script file, or operable program."
  const STALE =
    "& : The term 'C:\\x\\rove.cmd' is not recognized as the name of a cmdlet, function, script file, or operable program."
  const BLOCKED =
    "rove : File C:\\Users\\j\\AppData\\Roaming\\npm\\rove.ps1 cannot be loaded because running scripts is disabled on this system."

  test("is told apart in cmd, PowerShell 7, Windows PowerShell and for a stale path", () => {
    for (const output of [CMD, PWSH, POWERSHELL, STALE]) expect(WINDOWS_ROVE_MISSING.test(output)).toBe(true)
    expect(WINDOWS_ROVE_MISSING.test("'git' is not recognized as an internal or external command")).toBe(false)
    expect(WINDOWS_SCRIPTS_DISABLED.test(BLOCKED)).toBe(true)
  })

  test("says what to run on that machine", () => {
    expect(windowsNoRoveMessage("win", CMD)).toContain("npm install -g @sma1lboy/rove")
    const blocked = windowsNoRoveMessage("win", BLOCKED)
    expect(blocked).toContain("Set-ExecutionPolicy -Scope CurrentUser RemoteSigned")
    expect(blocked).toContain("HKLM:\\SOFTWARE\\OpenSSH -Name DefaultShell")
  })
})
