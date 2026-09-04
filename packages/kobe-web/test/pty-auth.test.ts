import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  expectedPtyToken,
  presentedPtyToken,
  ptyRequestAuthorized,
  ptyTokenAccepted,
  resetPtyTokenCache,
  webTokenPath,
} from "../pty-auth.mjs"

/**
 * The PTY routes spawn a shell in the worktree, so their gate is the one that
 * has to fail closed. These cases pin the two properties that matter: an
 * unauthenticated caller is refused even when it looks like a browser, and the
 * expected value comes from the same 0600 file the daemon writes.
 */

function homeWithToken(token: string | null, dir = ".rove"): string {
  const home = mkdtempSync(join(tmpdir(), "pty-auth-"))
  if (token !== null) {
    mkdirSync(join(home, dir), { recursive: true })
    writeFileSync(join(home, dir, "web-token"), token)
  }
  return home
}

afterEach(() => resetPtyTokenCache())

describe("presentedPtyToken", () => {
  const url = (search: string) => new URL(`http://localhost/pty${search}`)

  it("reads a bearer header case-insensitively", () => {
    expect(presentedPtyToken({ authorization: "Bearer tok-1" }, url(""))).toBe("tok-1")
    expect(presentedPtyToken({ authorization: "bearer  tok-2  " }, url(""))).toBe("tok-2")
  })

  it("falls back to ?token= — the only channel a WebSocket upgrade has", () => {
    expect(presentedPtyToken({}, url("?token=tok-ws"))).toBe("tok-ws")
  })

  it("is null when neither channel carries one", () => {
    expect(presentedPtyToken({}, url("?tab=t1"))).toBeNull()
    expect(presentedPtyToken({ authorization: "Basic abc" }, url(""))).toBeNull()
  })
})

describe("ptyTokenAccepted", () => {
  it("accepts only an exact match", () => {
    expect(ptyTokenAccepted("tok", "tok")).toBe(true)
    expect(ptyTokenAccepted("tok", "tuk")).toBe(false)
    expect(ptyTokenAccepted("to", "tok")).toBe(false)
    expect(ptyTokenAccepted("tokk", "tok")).toBe(false)
  })

  it("refuses an absent token on either side rather than matching empty to empty", () => {
    expect(ptyTokenAccepted(null, "tok")).toBe(false)
    expect(ptyTokenAccepted("", "")).toBe(false)
    expect(ptyTokenAccepted("tok", "")).toBe(false)
  })
})

describe("expectedPtyToken", () => {
  it("reads the daemon's token file under the resolved home", () => {
    const home = homeWithToken("file-token\n")
    expect(webTokenPath({ ROVE_HOME_DIR: home })).toBe(join(home, ".rove", "web-token"))
    expect(expectedPtyToken({ ROVE_HOME_DIR: home })).toBe("file-token")
  })

  it("honours the legacy .kobe layout only when the file is actually there", () => {
    const legacy = homeWithToken("legacy-token", ".kobe")
    expect(webTokenPath({ KOBE_HOME_DIR: legacy })).toBe(join(legacy, ".kobe", "web-token"))
    expect(expectedPtyToken({ KOBE_HOME_DIR: legacy })).toBe("legacy-token")
  })

  it("stays empty when no token file exists, so every request is refused", () => {
    const bare = homeWithToken(null)
    expect(expectedPtyToken({ ROVE_HOME_DIR: bare })).toBe("")
    expect(ptyRequestAuthorized({ authorization: "Bearer anything" }, new URL("http://localhost/pty"), { ROVE_HOME_DIR: bare })).toBe(false)
  })
})

describe("ptyRequestAuthorized", () => {
  it("admits a caller presenting the file's token through either channel", () => {
    const home = homeWithToken("live-token")
    const env = { ROVE_HOME_DIR: home }
    expect(ptyRequestAuthorized({ authorization: "Bearer live-token" }, new URL("http://localhost/pty/send"), env)).toBe(true)
    resetPtyTokenCache()
    expect(ptyRequestAuthorized({}, new URL("http://localhost/pty?token=live-token"), env)).toBe(true)
  })

  it("refuses the tokenless and wrong-token callers the origin check let through", () => {
    const home = homeWithToken("live-token")
    const env = { ROVE_HOME_DIR: home }
    // No Origin at all — a non-browser process, which `originAllowed` admits.
    expect(ptyRequestAuthorized({}, new URL("http://localhost/pty?tab=t1&taskId=k1"), env)).toBe(false)
    resetPtyTokenCache()
    // A page on another loopback port, which `originAllowed` also admits.
    expect(
      ptyRequestAuthorized(
        { origin: "http://localhost:3000", authorization: "Bearer guessed" },
        new URL("http://localhost/pty"),
        env,
      ),
    ).toBe(false)
  })
})
