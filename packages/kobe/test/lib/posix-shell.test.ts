import { describe, expect, it } from "vitest"
import { missingPosixShellHint, posixShell } from "../../src/lib/posix-shell.ts"

describe("posixShell", () => {
  it("stays bare `sh` on POSIX — never $SHELL", () => {
    // These command strings are POSIX sh; a login fish/zsh is not that
    // dialect, so the resolver must not reach for $SHELL here.
    expect(posixShell({ platform: "darwin", env: { SHELL: "/usr/local/bin/fish" } })).toBe("sh")
    expect(posixShell({ platform: "linux", env: {} })).toBe("sh")
  })

  it("resolves Git for Windows' bash on win32, where `sh` is not on PATH", () => {
    const shell = posixShell({
      platform: "win32",
      env: { ProgramFiles: "C:\\Program Files" },
      exists: (p: string) => p === "C:\\Program Files\\Git\\bin\\bash.exe",
    })
    expect(shell).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
  })

  it("names the real path when Git for Windows is missing, so the spawn error says so", () => {
    // Deliberately not bare `bash.exe`: System32's is the WSL launcher, which
    // would address a Linux filesystem that cannot see the Windows worktree.
    const shell = posixShell({ platform: "win32", env: {}, exists: () => false })
    expect(shell).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
    expect(shell).not.toBe("bash.exe")
  })
})

describe("missingPosixShellHint", () => {
  it("names the missing dependency on win32", () => {
    const hint = missingPosixShellHint({ platform: "win32" })
    expect(hint).toContain("Git for Windows")
    expect(hint).toContain("git-scm.com")
  })

  it("adds nothing on POSIX, where a missing `sh` is not a known story", () => {
    expect(missingPosixShellHint({ platform: "darwin" })).toBeNull()
    expect(missingPosixShellHint({ platform: "linux" })).toBeNull()
  })
})
