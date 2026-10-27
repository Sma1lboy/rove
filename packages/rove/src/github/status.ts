/**
 * What this machine can do with GitHub: its `gh` login, whether `git` pushes through it, and whether
 * an ssh key is accepted. Rove reads these tools' own state and keeps no token of its own.
 */

import type { LoginState } from "./login.ts"
import { GH_ENV, GITHUB_HOST, type RunTool, type ToolResult, runTool } from "./run-tool.ts"

export interface GithubSsh {
  readonly ok: boolean
  readonly user?: string
  readonly detail?: string
}

export interface GithubStatus {
  readonly git: string | null
  readonly gh: string | null
  /** The signed-in `gh` account on {@link GITHUB_HOST}; null when signed out or `gh` is absent. */
  readonly account: string | null
  /** Why `account` is null although `gh` is installed (expired token, no network). */
  readonly authDetail?: string
  readonly host: typeof GITHUB_HOST
  readonly protocol: "https" | "ssh" | null
  readonly scopes: readonly string[]
  /** git's credential helper for https://github.com runs `gh auth git-credential`. */
  readonly gitUsesGh: boolean
  readonly ssh: GithubSsh
  readonly login: LoginState | null
}

const PROBE_MS = 8_000
const VERSION_MS = 4_000

export function parseVersion(tool: "git" | "gh", result: ToolResult): string | null {
  if (result.missing || result.code !== 0) return null
  const match = new RegExp(`${tool} version (\\S+)`).exec(result.stdout)
  return match?.[1] ?? null
}

export interface GhAccount {
  readonly account: string | null
  readonly protocol: "https" | "ssh" | null
  readonly scopes: readonly string[]
  readonly detail?: string
}

interface GhHostEntry {
  state?: unknown
  active?: unknown
  login?: unknown
  scopes?: unknown
  gitProtocol?: unknown
  error?: unknown
}

/** The active account out of `gh auth status --json hosts`; null when the output is not that JSON. */
export function parseAuthStatus(stdout: string): GhAccount | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const hosts = (parsed as { hosts?: Record<string, unknown> } | null)?.hosts
  if (!hosts || typeof hosts !== "object") return null
  const entries = hosts[GITHUB_HOST]
  const list = Array.isArray(entries) ? (entries as GhHostEntry[]) : []
  const active = list.find((e) => e.active === true) ?? list[0]
  if (!active) return { account: null, protocol: null, scopes: [] }
  if (active.state !== "success" || typeof active.login !== "string") {
    return {
      account: null,
      protocol: null,
      scopes: [],
      ...(typeof active.error === "string" ? { detail: active.error.trim().slice(0, 200) } : {}),
    }
  }
  const scopes = typeof active.scopes === "string" ? active.scopes.split(",").map((s) => s.trim()) : []
  return {
    account: active.login,
    protocol: active.gitProtocol === "ssh" || active.gitProtocol === "https" ? active.gitProtocol : null,
    scopes: scopes.filter(Boolean),
  }
}

/** A `gh` too old for `auth status --json`: ask the API who the token belongs to. */
async function accountViaApi(run: RunTool): Promise<GhAccount> {
  const user = await run("gh", ["api", "user", "-q", ".login"], { timeoutMs: PROBE_MS, env: GH_ENV })
  const login = user.stdout.trim()
  if (user.code !== 0 || !login) {
    return { account: null, protocol: null, scopes: [], ...(user.timedOut ? { detail: "timed out" } : {}) }
  }
  const protocol = await run("gh", ["config", "get", "-h", GITHUB_HOST, "git_protocol"], {
    timeoutMs: VERSION_MS,
    env: GH_ENV,
  })
  const value = protocol.stdout.trim()
  return { account: login, protocol: value === "ssh" || value === "https" ? value : null, scopes: [] }
}

async function ghAccount(run: RunTool): Promise<GhAccount> {
  const res = await run("gh", ["auth", "status", "--hostname", GITHUB_HOST, "--json", "hosts"], {
    timeoutMs: PROBE_MS,
    env: GH_ENV,
  })
  if (res.timedOut) return { account: null, protocol: null, scopes: [], detail: "timed out" }
  return parseAuthStatus(res.stdout) ?? (await accountViaApi(run))
}

/** True when any github.com (or catch-all) credential helper is `gh auth git-credential`. */
export function parseGitUsesGh(configOutput: string): boolean {
  return configOutput.split("\n").some((line) => /auth git-credential/.test(line))
}

/** `ssh -T git@github.com` always exits 1; the greeting says whether a key was accepted. */
export function parseSshProbe(result: ToolResult): GithubSsh {
  if (result.missing) return { ok: false, detail: "ssh is not installed" }
  if (result.timedOut) return { ok: false, detail: "timed out" }
  const text = `${result.stderr}\n${result.stdout}`
  const hi = /Hi ([A-Za-z0-9-]+)! You've successfully authenticated/.exec(text)
  if (hi?.[1]) return { ok: true, user: hi[1] }
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^git@github\.com: /, "").trim())
    .filter(Boolean)
  const reason = lines.find((l) =>
    /Permission denied|Host key verification failed|Could not resolve|Connection /.test(l),
  )
  const detail = (reason ?? lines[lines.length - 1] ?? "ssh failed").slice(0, 160)
  return { ok: false, detail }
}

export async function githubStatus(deps: {
  readonly run?: RunTool
  readonly login: () => LoginState | null
}): Promise<GithubStatus> {
  const run = deps.run ?? runTool
  const [git, gh, helpers, ssh] = await Promise.all([
    run("git", ["--version"], { timeoutMs: VERSION_MS }),
    run("gh", ["--version"], { timeoutMs: VERSION_MS, env: GH_ENV }),
    run("git", ["config", "--get-regexp", "^credential\\.(https://github\\.com\\.)?helper$"], {
      timeoutMs: VERSION_MS,
    }),
    run(
      "ssh",
      ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=5", `git@${GITHUB_HOST}`],
      { timeoutMs: PROBE_MS },
    ),
  ])
  const ghVersion = parseVersion("gh", gh)
  const auth: GhAccount = ghVersion
    ? await ghAccount(run)
    : { account: null, protocol: null, scopes: [], detail: "gh is not installed" }
  return {
    git: parseVersion("git", git),
    gh: ghVersion,
    account: auth.account,
    ...(auth.account === null && auth.detail && ghVersion ? { authDetail: auth.detail } : {}),
    host: GITHUB_HOST,
    protocol: auth.protocol,
    scopes: auth.scopes,
    gitUsesGh: parseGitUsesGh(helpers.stdout),
    ssh: parseSshProbe(ssh),
    login: deps.login(),
  }
}
