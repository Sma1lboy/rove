import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DAEMON_WEB_HEALTH_PATH, requiresWebToken } from "../../../kobe-daemon/src/daemon/web-server.ts"
import { ensureWebToken, presentedToken, tokensMatch } from "../../../kobe-daemon/src/daemon/web-token.ts"
import { type DaemonHarness, bootDaemonHarness } from "./harness.ts"

/**
 * Bearer-token auth for the daemon-hosted web transport.
 *
 * Why this file exists: 22 RPCs are marked `web: true`, including
 * `task.setCommand` — which sets the engine's launch argv, i.e. arbitrary
 * command execution. The other gate, the Origin check, is a CSRF control and
 * not authentication: `originAllowed(null)` returns true, so on its own it
 * lets any `curl` (which sends no Origin) drive the daemon. The first
 * describe block below is the whole point of the feature.
 */

const TOKEN = "test-token-abc123"

describe("web transport auth", () => {
  let harness: DaemonHarness

  beforeEach(async () => {
    harness = await bootDaemonHarness({ web: { webToken: TOKEN } })
  })
  afterEach(async () => {
    await harness.close()
  })

  it("rejects a request carrying no token at all", async () => {
    // The `curl` case: no Origin (so the CSRF check passes) and no credential.
    const res = await harness.web!.fetch("/api/projects")
    expect(res.status).toBe(401)
  })

  it("rejects a mutating RPC with no token", async () => {
    // task.setCommand is the RPC that makes this a command-execution surface.
    const res = await harness.web!.fetch("/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "task.setCommand", payload: { taskId: "x", command: ["sh", "-c", "id"] } }),
    })
    expect(res.status).toBe(401)
  })

  it("rejects a wrong token", async () => {
    const res = await harness.web!.fetch("/api/projects", {
      headers: { authorization: "Bearer not-the-token" },
    })
    expect(res.status).toBe(401)
  })

  it("names the fix in the 401 body", async () => {
    // Shaped like the CLI's typed errors: the caller who trips this is a
    // script that never knew about the token, or a stale browser tab.
    const res = await harness.web!.fetch("/api/projects")
    const body = (await res.json()) as { error: string; hint?: string; nextCommandArgs?: string[] }
    expect(body.error).toMatch(/unauthorized/i)
    expect(body.hint).toMatch(/web-token/)
    expect(body.nextCommandArgs).toEqual(["daemon", "restart"])
  })

  it("accepts the token as a bearer header", async () => {
    const res = await harness.web!.fetch("/api/projects", {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(200)
  })

  it("accepts the token as a query param (EventSource cannot set headers)", async () => {
    const res = await harness.web!.fetch(`/api/projects?token=${TOKEN}`)
    expect(res.status).toBe(200)
  })

  it("leaves the health probe reachable without a token", async () => {
    // A starting daemon probes this to detect a port already held, before any
    // token is in hand; gating it would make the port-conflict path unusable.
    const res = await harness.web!.fetch("/__kobe_web")
    expect(res.status).toBe(200)
  })

  it("still rejects a cross-origin request that HAS a valid token", async () => {
    // Origin and token stack: holding the token does not license a hostile page.
    const res = await harness.web!.fetch("/api/projects", {
      headers: { authorization: `Bearer ${TOKEN}`, origin: "http://evil.example" },
    })
    expect(res.status).toBe(403)
  })
})

describe("web transport auth — disabled", () => {
  it("serves requests untouched when no token is configured", async () => {
    // Route-level tests (and old embedders) construct the handler without a
    // token; that must stay a working, unauthenticated handler.
    const harness = await bootDaemonHarness({ web: true })
    try {
      expect((await harness.web!.fetch("/api/projects")).status).toBe(200)
    } finally {
      await harness.close()
    }
  })
})

describe("token file", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kobe-web-token-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const mode = (p: string): string => (statSync(p).mode & 0o777).toString(8)

  it("mints a token and persists it 0600 in a 0700 directory", () => {
    const file = join(dir, "state", "web-token")
    const token = ensureWebToken(file)
    expect(token.length).toBeGreaterThan(20)
    expect(readFileSync(file, "utf8")).toBe(token)
    expect(mode(file)).toBe("600")
    expect(mode(join(dir, "state"))).toBe("700")
  })

  it("returns the same token on a second read", () => {
    const file = join(dir, "web-token")
    expect(ensureWebToken(file)).toBe(ensureWebToken(file))
  })

  it("tightens an ALREADY-EXISTING 0644 file in an 0755 directory", () => {
    // `mode` on mkdirSync/writeFileSync binds only at CREATION, so a path
    // created under a laxer umask keeps its loose modes forever. Asserting
    // the call arguments would miss that entirely — this builds the loose
    // fixture on disk and re-reads the modes afterwards.
    const loose = join(dir, "loose")
    mkdirSync(loose, { recursive: true })
    chmodSync(loose, 0o755)
    const file = join(loose, "web-token")
    writeFileSync(file, "pre-existing-token", "utf8")
    chmodSync(file, 0o644)
    expect(mode(file)).toBe("644")
    expect(mode(loose)).toBe("755")

    const token = ensureWebToken(file)

    expect(token).toBe("pre-existing-token") // preserved, not regenerated
    expect(mode(file)).toBe("600")
    expect(mode(loose)).toBe("700")
  })

  it("regenerates after the file is deleted (rotation is `rm` + restart)", () => {
    const file = join(dir, "web-token")
    const first = ensureWebToken(file)
    rmSync(file)
    const second = ensureWebToken(file)
    expect(second).not.toBe(first)
    expect(mode(file)).toBe("600")
  })
})

describe("token comparison + extraction", () => {
  it("rejects empty/absent presented tokens", () => {
    expect(tokensMatch(null, "abc")).toBe(false)
    expect(tokensMatch(undefined, "abc")).toBe(false)
    expect(tokensMatch("", "abc")).toBe(false)
  })

  it("rejects a prefix of the real token", () => {
    expect(tokensMatch("abc", "abcdef")).toBe(false)
    expect(tokensMatch("abcdef", "abcdef")).toBe(true)
  })

  const req = (headers: Record<string, string> = {}, path = "/api/projects"): [Request, URL] => {
    const url = new URL(path, "http://127.0.0.1")
    return [new Request(url.toString(), { headers }), url]
  }

  it("reads a bearer header case-insensitively", () => {
    expect(presentedToken(...req({ authorization: "Bearer tok" }))).toBe("tok")
    expect(presentedToken(...req({ authorization: "bearer tok" }))).toBe("tok")
  })

  it("falls back to the query param", () => {
    expect(presentedToken(...req({}, "/events?token=tok"))).toBe("tok")
  })

  it("returns null when neither channel carries one", () => {
    expect(presentedToken(...req())).toBe(null)
  })
})

describe("protected surface", () => {
  const needs = (path: string): boolean => requiresWebToken(new URL(path, "http://127.0.0.1"), DAEMON_WEB_HEALTH_PATH)

  it("guards every route that reads or mutates daemon state", () => {
    // Enumerated from the route table + the runtime-supplied handlers: they
    // all live under /api/ or /events, which is what makes the prefix rule
    // total rather than a guess.
    for (const path of [
      "/api/rpc",
      "/api/session",
      "/api/engine-spec",
      "/api/terminal-spec",
      "/api/engines",
      "/api/cli-invocation",
      "/api/projects",
      "/api/settings",
      "/api/quick-prompts",
      "/api/notes",
      "/api/diff",
      "/api/history/sessions",
      "/api/history/messages",
      "/api/issues",
      "/api/issue-assets/abc",
      "/api/worktrees",
      "/api/themes",
      "/events",
    ]) {
      expect(needs(path), path).toBe(true)
    }
  })

  it("leaves the static shell public", () => {
    // A browser fetches subresources itself, and cannot attach a bearer header
    // or the query token to them. Gating these 401s every script the page just
    // requested, so the dashboard renders blank with a perfectly valid token.
    for (const path of ["/", "/index.html", "/assets/index-abc123.js", "/assets/index.css", "/favicon.ico"]) {
      expect(needs(path), path).toBe(false)
    }
    expect(needs("/__kobe_web")).toBe(false)
  })
})
