import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { type ApiEnvelope, ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { describe, expect, it, vi } from "vitest"
import { executeVerb } from "../../src/cli/api/invoke.ts"
import { REMOTE_CALLER, daemonCaller } from "../../src/cli/api/types.ts"
import { applyToken, autoSyncSignedOut } from "../../src/github/credentials.ts"
import { DeviceLogin, type LoginProcess, parseDeviceOutput } from "../../src/github/login.ts"
import type { RunTool, ToolResult } from "../../src/github/run-tool.ts"
import { githubStatus, parseAuthStatus, parseSshProbe } from "../../src/github/status.ts"
import { inboundClassOf, inboundRefusal } from "../../src/machines/inbound.ts"

const result = (over: Partial<ToolResult>): ToolResult => ({
  code: 0,
  stdout: "",
  stderr: "",
  missing: false,
  timedOut: false,
  ...over,
})

const SIGNED_IN = JSON.stringify({
  hosts: {
    "github.com": [
      {
        state: "success",
        active: true,
        host: "github.com",
        login: "octo",
        scopes: "gist, read:org, repo, workflow",
        gitProtocol: "ssh",
      },
    ],
  },
})

describe("gh auth status", () => {
  it("reads the active account, its scopes and git protocol", () => {
    expect(parseAuthStatus(SIGNED_IN)).toEqual({
      account: "octo",
      protocol: "ssh",
      scopes: ["gist", "read:org", "repo", "workflow"],
    })
  })

  it("an empty host list and a failed token both read as signed out, the latter with gh's reason", () => {
    expect(parseAuthStatus('{"hosts":{}}')).toMatchObject({ account: null })
    const expired = JSON.stringify({
      hosts: { "github.com": [{ state: "error", active: true, login: "octo", error: "token expired" }] },
    })
    expect(parseAuthStatus(expired)).toMatchObject({ account: null, detail: "token expired" })
  })

  it("text that is not the JSON is not guessed at", () => {
    expect(parseAuthStatus("You are not logged into any GitHub hosts.")).toBeNull()
  })
})

describe("ssh probe", () => {
  it("ssh -T exits 1 either way: the greeting is what says a key was accepted", () => {
    const hi = result({
      code: 1,
      stderr: "Hi octo! You've successfully authenticated, but GitHub does not provide shell access.\n",
    })
    expect(parseSshProbe(hi)).toEqual({ ok: true, user: "octo" })
    const denied = result({ code: 255, stderr: "git@github.com: Permission denied (publickey).\n" })
    expect(parseSshProbe(denied)).toEqual({ ok: false, detail: "Permission denied (publickey)." })
  })

  it("an unknown host key is reported, not accepted", () => {
    const unknown = result({ code: 255, stderr: "Host key verification failed.\n" })
    expect(parseSshProbe(unknown)).toMatchObject({ ok: false, detail: "Host key verification failed." })
  })
})

describe("githubStatus", () => {
  it("a machine with no gh, git or ssh is a value, never an error", async () => {
    const gone: RunTool = async () => result({ code: null, missing: true })
    const status = await githubStatus({ run: gone, login: () => null })
    expect(status).toMatchObject({
      git: null,
      gh: null,
      account: null,
      protocol: null,
      gitUsesGh: false,
      ssh: { ok: false },
      login: null,
    })
  })

  it("a signed-in machine reports account, versions and whether git pushes through gh", async () => {
    const run: RunTool = async (cmd, args) => {
      if (cmd === "git" && args[0] === "--version") return result({ stdout: "git version 2.50.1\n" })
      if (cmd === "gh" && args[0] === "--version") return result({ stdout: "gh version 2.92.0 (2026-04-28)\n" })
      if (cmd === "gh" && args[0] === "auth") return result({ stdout: SIGNED_IN })
      if (cmd === "git") {
        return result({ stdout: "credential.https://github.com.helper !/opt/homebrew/bin/gh auth git-credential\n" })
      }
      return result({
        code: 1,
        stderr: "Hi octo! You've successfully authenticated, but GitHub does not provide shell access.",
      })
    }
    const status = await githubStatus({ run, login: () => ({ state: "syncing" }) })
    expect(status).toMatchObject({
      git: "2.50.1",
      gh: "2.92.0",
      account: "octo",
      protocol: "ssh",
      gitUsesGh: true,
      ssh: { ok: true, user: "octo" },
      login: { state: "syncing" },
    })
  })
})

describe("device flow", () => {
  it("takes the one-time code and URL out of gh's output", () => {
    const out =
      "\n! First copy your one-time code: 1AEC-993B\nOpen this URL to continue in your web browser: https://github.com/login/device\n"
    expect(parseDeviceOutput(out)).toEqual({ code: "1AEC-993B", url: "https://github.com/login/device" })
    expect(parseDeviceOutput("! First copy your one-time code: 1AEC")).toEqual({})
  })

  function fakeGh() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    })
    return { child, process: child as unknown as LoginProcess }
  }
  const OUT =
    "! First copy your one-time code: AAAA-1111\nOpen this URL to continue in your web browser: https://github.com/login/device\n"

  it("one flow per machine: a second start returns the pending code, and cancel kills the child", async () => {
    const gh = fakeGh()
    const spawn = vi.fn(() => gh.process)
    const login = new DeviceLogin({ spawn, finish: async () => {} })
    const first = login.start(true)
    gh.child.stderr.write(OUT)
    await expect(first).resolves.toEqual({
      state: "pending",
      code: "AAAA-1111",
      url: "https://github.com/login/device",
    })
    await expect(login.start(true)).resolves.toMatchObject({ code: "AAAA-1111" })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(login.cancel()).toBe(true)
    expect(gh.child.kill).toHaveBeenCalled()
    expect(login.state()).toBeNull()
  })

  it("a flow gh ends without signing in stays failed with gh's message", async () => {
    const gh = fakeGh()
    const login = new DeviceLogin({ spawn: () => gh.process, finish: async () => {} })
    const started = login.start(true)
    gh.child.stdout.write(OUT)
    await started
    gh.child.stderr.write("failed to authenticate via web browser: expired_token\n")
    gh.child.emit("close", 1)
    expect(login.state()).toEqual({ state: "failed", error: "failed to authenticate via web browser: expired_token" })
  })

  it("success runs the finish step with whether to bring other machines along, then clears", async () => {
    const gh = fakeGh()
    const finish = vi.fn(async () => {})
    const login = new DeviceLogin({ spawn: () => gh.process, finish })
    const started = login.start(false)
    gh.child.stdout.write(OUT)
    await started
    gh.child.emit("close", 0)
    expect(login.state()).toEqual({ state: "syncing" })
    expect(finish).toHaveBeenCalledWith(false)
    await vi.waitFor(() => expect(login.state()).toBeNull())
  })

  it("no code within the wait kills the child and rejects", async () => {
    const gh = fakeGh()
    const login = new DeviceLogin({ spawn: () => gh.process, finish: async () => {}, codeWaitMs: 20 })
    await expect(login.start(true)).rejects.toMatchObject({ code: "GITHUB_LOGIN_FAILED" })
    expect(gh.child.kill).toHaveBeenCalled()
  })
})

describe("applying a token", () => {
  const TOKEN = "gho_abcdefghijklmnopqrstuvwxyz0123456789"

  it("only a call forwarded from another machine may apply", async () => {
    const direct = await executeVerb(
      "github-apply",
      { params: { token: TOKEN } },
      { client: null, caller: REMOTE_CALLER },
    )
    expect(direct).toMatchObject({ ok: false, error: { code: "GITHUB_APPLY_FORWARDED_ONLY" } })
    const local = await executeVerb(
      "github-apply",
      { params: { token: TOKEN } },
      { client: null, caller: daemonCaller(false) },
    )
    expect(local).toMatchObject({ ok: false, error: { code: "GITHUB_APPLY_FORWARDED_ONLY" } })
  })

  it("the token goes to gh over stdin, never in argv, and never comes back in an error", async () => {
    const calls: Array<{ args: readonly string[]; input?: string }> = []
    const run: RunTool = async (_cmd, args, opts) => {
      calls.push({ args, input: opts.input })
      return args[1] === "login" ? result({ code: 1, stderr: `error validating ${TOKEN}` }) : result({})
    }
    const err = await applyToken(TOKEN, run).catch((e: Error) => e)
    expect(err).toMatchObject({ code: "GITHUB_LOGIN_FAILED" })
    expect((err as Error).message).not.toContain(TOKEN)
    expect(calls[0]?.input).toBe(`${TOKEN}\n`)
    expect(calls.flatMap((c) => c.args).join(" ")).not.toContain(TOKEN)
  })

  it("something that cannot be a token never reaches gh", async () => {
    const run = vi.fn<RunTool>()
    await expect(applyToken("--hostname evil", run)).rejects.toMatchObject({ code: "BAD_FLAG" })
    expect(run).not.toHaveBeenCalled()
  })

  it("a hub cannot make this machine push its token on to a third machine", async () => {
    const out = await executeVerb(
      "github-sync",
      { params: { to: "other" } },
      { client: null, caller: daemonCaller(true) },
    )
    expect(out).toMatchObject({ ok: false, error: { code: "GITHUB_SYNC_FORWARDED" } })
  })
})

describe("bringing the other machines along after a sign-in", () => {
  const TOKEN = "gho_abcdefghijklmnopqrstuvwxyz0123456789"
  const entry = (alias: string) => ({ alias, host: `${alias}.test`, auth: { kind: "key" as const } })
  const ok = (result: unknown): ApiEnvelope => ({ apiVersion: ROVE_API_VERSION, ok: true, result })
  const down = (code: string): ApiEnvelope => ({
    apiVersion: ROVE_API_VERSION,
    ok: false,
    error: { code, message: code },
  })
  const status = (over: object) => ({ gh: "2.92.0", account: null, ...over })

  it("signs in only the machines that are online, have gh and are signed out", async () => {
    const reply: Record<string, ApiEnvelope> = {
      signedOut: ok(status({})),
      other: ok(status({ account: "someone-else" })),
      same: ok(status({ account: "octo" })),
      expired: ok(status({ authDetail: "token expired" })),
      noGh: ok(status({ gh: null })),
      offline: down("MACHINE_UNREACHABLE"),
      old: down("UNKNOWN_VERB"),
    }
    const applied: string[] = []
    const forward = vi.fn(async (machine: { alias: string }, verb: string, params: Record<string, unknown>) => {
      if (verb === "github-apply") {
        expect(params).toEqual({ token: TOKEN })
        applied.push(machine.alias)
        return ok(status({ account: "octo" }))
      }
      return reply[machine.alias] as ApiEnvelope
    })
    const synced = await autoSyncSignedOut(TOKEN, forward as never, Object.keys(reply).map(entry))
    expect(synced).toEqual(["signedOut"])
    expect(applied).toEqual(["signedOut"])
  })
})

describe("inbound policy for credentials", () => {
  it("the verbs that sign gh in or out are their own class; status is a plain read", () => {
    for (const verb of ["github-login", "github-logout", "github-sync", "github-apply"]) {
      expect(inboundClassOf(verb)).toBe("credentials")
    }
    expect(inboundClassOf("github-status")).toBe("read")
  })

  it("denying credentials refuses exactly those verbs", () => {
    const state = { machineInbound: { deny: ["credentials"] } }
    expect(inboundRefusal("github-apply", state)).toBe("credentials")
    expect(inboundRefusal("github-status", state)).toBeNull()
    expect(inboundRefusal("constructor", state)).toBeNull()
  })
})
