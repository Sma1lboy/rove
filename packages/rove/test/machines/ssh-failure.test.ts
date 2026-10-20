import { describe, expect, it } from "vitest"
import { classifySshFailure } from "../../src/machines/ssh-failure.ts"

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
