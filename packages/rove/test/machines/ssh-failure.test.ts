import { describe, expect, it } from "vitest"
import { classifySshFailure, sshFailureRemedy } from "../../src/machines/ssh-failure.ts"
import { WINDOWS_SSHD_BANNER } from "../../src/machines/windows-remote.ts"

/** Captured from OpenSSH 9 (Linux) unless noted; each kind has a different remedy. */
describe("classifySshFailure", () => {
  it.each([
    ["ssh: Could not resolve hostname nosuchhost.invalid: Name or service not known", "unresolved"],
    ["ssh: Could not resolve hostname narwhal: nodename nor servname provided, or not known", "unresolved"], // macOS
    ["ssh: connect to host 127.0.0.1 port 2223: Connection refused", "refused"],
    ["ssh: connect to host 10.255.255.1 port 22: Connection timed out", "timeout"],
    ["ssh: connect to host narwhal port 22: Operation timed out", "timeout"], // macOS
    ["nobody@127.0.0.1: Permission denied (publickey).", "auth-denied"],
    [
      "No ED25519 host key is known for [127.0.0.1]:2222 and you have requested strict checking.\nHost key verification failed.",
      "host-key-unverified",
    ],
    ["ssh: Connection closed by remote host", "unknown"],
  ])("%s → %s", (stderr, kind) => {
    expect(classifySshFailure(stderr)).toBe(kind)
  })

  it("reads a changed host key as changed, though ssh also says verification failed", () => {
    const stderr = [
      "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
      "IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!",
      "Offending ED25519 key in /root/.ssh/known_hosts:3",
      "Host key verification failed.",
    ].join("\n")
    expect(classifySshFailure(stderr)).toBe("host-key-changed")
  })
})

describe("sshFailureRemedy on a Windows machine", () => {
  it("names the OpenSSH Server steps when nothing listens", () => {
    const remedy = sshFailureRemedy("refused", "win", true)
    expect(remedy).toContain("Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0")
    expect(remedy).toContain("Start-Service sshd")
    expect(remedy).toContain("OpenSSH-Server-In-TCP")
  })

  it("sends an administrator to the one key file OpenSSH for Windows reads", () => {
    expect(sshFailureRemedy("auth-denied", "win", true)).toContain("administrators_authorized_keys")
  })

  it("reads the server banner `ssh -v` prints before any login", () => {
    // Verbatim from OpenSSH for Windows 9.5.
    const stderr = "debug1: Remote protocol version 2.0, remote software version OpenSSH_for_Windows_9.5"
    expect(WINDOWS_SSHD_BANNER.test(stderr)).toBe(true)
    expect(WINDOWS_SSHD_BANNER.test("debug1: Remote protocol version 2.0, remote software version OpenSSH_9.6")).toBe(
      false,
    )
  })
})
