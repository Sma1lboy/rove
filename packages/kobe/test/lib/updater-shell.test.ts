import { describe, expect, it } from "vitest"
import { updaterShell, updaterShellFailureHint } from "../../src/lib/updater-shell.ts"

describe("updaterShell", () => {
  it("stays bare `sh` on POSIX — never $SHELL", () => {
    // The update script is written in POSIX sh; a login fish/zsh is not that
    // dialect, so the resolver must not reach for $SHELL here.
    expect(updaterShell({ platform: "darwin", env: { SHELL: "/usr/local/bin/fish" } })).toBe("sh")
    expect(updaterShell({ platform: "linux", env: {} })).toBe("sh")
  })

  it("resolves Git for Windows' bash on win32, where `sh` is not on PATH", () => {
    const shell = updaterShell({
      platform: "win32",
      env: { ProgramFiles: "C:\\Program Files" },
      exists: (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe",
    })
    expect(shell).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
  })

  it("names the real path when Git for Windows is missing, so the spawn error says so", () => {
    // Deliberately not bare `bash.exe`: System32's is the WSL launcher, which
    // would install into a Linux prefix the Windows PATH never sees.
    const shell = updaterShell({ platform: "win32", env: {}, exists: () => false })
    expect(shell).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
    expect(shell).not.toBe("bash.exe")
  })
})

describe("updaterShellFailureHint", () => {
  it("names the missing dependency on win32 and hands over the manual route", () => {
    const hint = updaterShellFailureHint({ platform: "win32" })
    expect(hint).toContain("Git for Windows")
    expect(hint).toContain("npm install -g")
  })

  it("adds nothing on POSIX, where a missing `sh` is not a known story", () => {
    expect(updaterShellFailureHint({ platform: "darwin" })).toBeNull()
    expect(updaterShellFailureHint({ platform: "linux" })).toBeNull()
  })
})
