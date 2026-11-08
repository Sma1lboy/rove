/**
 * Setting dictation up from the page: what this host can run, installing the local recognizer, saving a cloud
 * endpoint, and keeping the sidecar running once either is set up. Node APIs only: the published CLI runs
 * the bridge under node.
 *
 * Install is a detached job, not a long request: a phone that sleeps mid-download must not kill it. It writes
 * `<voice>/install.json` (its pid) and `<voice>/install.log`, whose last line is `__exit <code>` when it ends;
 * `voice.status` reads both, so any page, before or after a reconnect, sees the same progress.
 */

import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, statfsSync, writeFileSync } from "node:fs"
import { arch, homedir, platform } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { BridgeError } from "../protocol.ts"
import type { Args, OpTable } from "./types.ts"
import { type VoiceHealth, voiceDir, voiceHealth, voicePort } from "./voice.ts"

/** large-v3 is ~3.1 GB on disk; the environment adds ~0.4 GB. */
const LOCAL_BYTES = 3.5 * 1024 ** 3
/** One spawn per this long: two bridges or a polling page must not start a sidecar each. */
const SPAWN_GAP_MS = 30_000
const TEXT_MAX = 300

/** `scripts/voice` in a checkout, else the copy the release ships in `dist/voice`. */
export function voiceCodeDir(): string | null {
  const here = fileURLToPath(import.meta.url)
  const candidates = [
    resolve(here, "../../../../../scripts/voice"), // dev: packages/rove-bridge/src/ops → repo root
    resolve(here, "../../voice"), // packaged: dist/cli/<chunk> → dist/voice
  ]
  return candidates.find((dir) => existsSync(join(dir, "asr_server.py"))) ?? null
}

/** `uv` on PATH or where its installers put it: a bridge started by launchd has a short PATH. */
export function findUv(): string | null {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local/bin"),
    join(homedir(), ".cargo/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
  return dirs.map((dir) => join(dir, "uv")).find((path) => path.startsWith("/") && existsSync(path)) ?? null
}

const venvDir = () => join(voiceDir(), "venv")

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return null
  }
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export interface VoiceConfig {
  readonly backend?: "local" | "cloud"
  readonly model?: string
  readonly baseURL?: string
  readonly apiKey?: string
  readonly apiKeyEnv?: string
  readonly [key: string]: unknown
}

const configPath = () => join(voiceDir(), "config.json")
export const readConfig = (): VoiceConfig => readJson<VoiceConfig>(configPath()) ?? {}

/** 0600: it may hold an API key. */
export function writeConfig(config: VoiceConfig): void {
  mkdirSync(voiceDir(), { recursive: true })
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(configPath(), 0o600)
}

export type InstallPhase = "idle" | "running" | "done" | "failed"

export interface InstallState {
  readonly phase: InstallPhase
  /** The job's latest output line: what it is fetching, or why it failed. */
  readonly line: string | null
}

/** The install job as its files tell it: a log ending in `__exit N` finished; a live pid is still running. */
export function installState(): InstallState {
  const job = readJson<{ pid?: number }>(join(voiceDir(), "install.json"))
  if (!job) return { phase: "idle", line: null }
  let log = ""
  try {
    log = readFileSync(join(voiceDir(), "install.log"), "utf8")
  } catch {}
  // Download bars redraw with \r: the last segment is the current one.
  const lines = log
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const exit = lines.findLast((l) => l.startsWith("__exit "))
  const last = lines.findLast((l) => !l.startsWith("__exit ")) ?? null
  if (exit) return { phase: exit === "__exit 0" ? "done" : "failed", line: last }
  if (alive(job.pid)) return { phase: "running", line: last }
  return { phase: "failed", line: last ?? "the install stopped before it finished" }
}

export interface VoiceSetup {
  /** Apple Silicon: the only place the local recognizer runs. */
  readonly localSupported: boolean
  readonly uv: boolean
  readonly freeBytes: number | null
  /** The local model is downloaded (`installed.json`, written by `fetch_model.py`). */
  readonly localInstalled: boolean
  readonly install: InstallState
  readonly backend: "local" | "cloud"
  /** Never the key itself: only whether one is set. */
  readonly cloud: { readonly baseURL: string; readonly model: string; readonly hasKey: boolean } | null
  /** Why no install button: missing uv, wrong machine, too little disk. */
  readonly blocked: string | null
}

function freeBytes(): number | null {
  try {
    const fs = statfsSync(homedir())
    return fs.bavail * fs.bsize
  } catch {
    return null
  }
}

export function voiceSetup(): VoiceSetup {
  const config = readConfig()
  const localSupported = platform() === "darwin" && arch() === "arm64"
  const uv = findUv() !== null
  const free = freeBytes()
  const localInstalled = existsSync(join(voiceDir(), "installed.json"))
  const hasKey = Boolean(config.apiKey || (config.apiKeyEnv && process.env[config.apiKeyEnv]))
  const blocked = !voiceCodeDir()
    ? "this Rove build does not include the voice sidecar"
    : !uv
      ? "uv is not installed: curl -LsSf https://astral.sh/uv/install.sh | sh"
      : !localSupported
        ? "the local recognizer needs an Apple Silicon Mac; a cloud endpoint works here"
        : free !== null && free < LOCAL_BYTES && !localInstalled
          ? `the local model needs ~3.5 GB free; ${(free / 1024 ** 3).toFixed(1)} GB is`
          : null
  return {
    localSupported,
    uv,
    freeBytes: free,
    localInstalled,
    install: installState(),
    backend: config.backend === "cloud" ? "cloud" : "local",
    cloud:
      config.backend === "cloud"
        ? { baseURL: String(config.baseURL ?? ""), model: String(config.model ?? ""), hasKey }
        : null,
    blocked,
  }
}

/** Set up enough that the sidecar should be running: the chosen backend has what it needs. */
export const configured = (setup: VoiceSetup): boolean =>
  setup.backend === "cloud" ? setup.cloud?.hasKey === true : setup.localInstalled

function uvEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ROVE_VOICE_HOME: voiceDir(),
    ROVE_VOICE_PORT: String(voicePort()),
    // The environment lives with the user's state, not in the (maybe read-only) install directory.
    UV_PROJECT_ENVIRONMENT: venvDir(),
  }
}

function detached(command: string, args: readonly string[], log: string): number | undefined {
  mkdirSync(voiceDir(), { recursive: true })
  const out = openSync(join(voiceDir(), log), "a")
  const child = spawn(command, args, { detached: true, stdio: ["ignore", out, out], env: uvEnv() })
  child.unref()
  return child.pid
}

let lastSpawn = 0

/** Start the sidecar when it is set up and nothing answers; a second bridge's start simply exits on the port. */
export function startSidecar(force = false): boolean {
  const code = voiceCodeDir()
  const uv = findUv()
  if (!code || !uv || !existsSync(venvDir())) return false
  if (!force && Date.now() - lastSpawn < SPAWN_GAP_MS) return false
  lastSpawn = Date.now()
  detached(
    uv,
    ["run", "--frozen", "--no-sync", "--project", code, "python", join(code, "asr_server.py")],
    "sidecar.log",
  )
  return true
}

/** Stop the sidecar this machine runs, by its pidfile, and start it again on the current config. */
async function restartSidecar(): Promise<void> {
  const pid = Number(readJson<number>(join(voiceDir(), "sidecar.pid")) ?? 0)
  if (alive(pid)) process.kill(pid, "SIGTERM")
  for (let i = 0; i < 25 && (await voiceHealth()).up; i++) await sleep(200)
  startSidecar(true)
}

function startInstall(local: boolean): void {
  const code = voiceCodeDir()
  const uv = findUv()
  if (!code || !uv) throw new BridgeError("VOICE_SETUP", voiceSetup().blocked ?? "cannot install here")
  if (installState().phase === "running") return
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  const steps = [
    `${q(uv)} sync --frozen --project ${q(code)}${local ? " --extra local" : ""}`,
    ...(local
      ? [`${q(uv)} run --frozen --no-sync --project ${q(code)} python ${q(join(code, "fetch_model.py"))}`]
      : []),
  ]
  writeFileSync(join(voiceDir(), "install.log"), "")
  const script = `( set -e; ${steps.join("; ")} ); echo "__exit $?"`
  const pid = detached("/bin/sh", ["-c", script], "install.log")
  writeFileSync(join(voiceDir(), "install.json"), JSON.stringify({ pid, local, at: Date.now() }))
}

export interface VoiceStatus extends VoiceHealth {
  readonly port: number
  /** The mic belongs on the page: the sidecar answers, or it is set up and being started. */
  readonly available: boolean
  readonly setup: VoiceSetup
}

async function status(): Promise<VoiceStatus> {
  const health = await voiceHealth()
  const setup = voiceSetup()
  if (!health.up && configured(setup)) startSidecar()
  return { ...health, port: voicePort(), available: health.up || configured(setup), setup }
}

function httpUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString().replace(/\/$/, "")
  } catch {}
  throw new BridgeError("BAD_ARGS", "baseURL must be an http(s) URL")
}

const text = (a: Args, name: string): string | undefined => {
  const value = a[name]
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string" || value.length > TEXT_MAX) throw new BridgeError("BAD_ARGS", `${name} must be text`)
  return value.trim()
}

export const voiceSetupOps: OpTable = {
  "voice.status": {
    kind: "read",
    destructive: false,
    wraps: "GET :8791/health of scripts/voice/asr_server.py, plus what this host can set up (starts a set-up sidecar)",
    run: status,
  },
  "voice.install": {
    kind: "write",
    destructive: false,
    wraps: "uv sync --extra local + fetch_model.py in scripts/voice, as a detached job (voice.status reports it)",
    async run() {
      const setup = voiceSetup()
      if (setup.blocked) throw new BridgeError("VOICE_SETUP", setup.blocked)
      startInstall(true)
      return status()
    },
  },
  "voice.configure": {
    kind: "write",
    destructive: false,
    wraps: "write <ROVE_HOME>/.rove/voice/config.json (0600) and restart the sidecar on it",
    async run(a: Args) {
      const backend = a.backend === "cloud" ? "cloud" : a.backend === "local" ? "local" : null
      if (!backend) throw new BridgeError("BAD_ARGS", "backend must be local or cloud")
      const now = readConfig()
      let next: VoiceConfig
      if (backend === "cloud") {
        const baseURL = httpUrl(text(a, "baseURL") ?? "")
        const model = text(a, "model")
        if (!model) throw new BridgeError("BAD_ARGS", "model is required")
        // An empty key field keeps the saved one: the page never sees it to send it back.
        const apiKey = text(a, "apiKey") ?? now.apiKey
        if (!apiKey && !now.apiKeyEnv) throw new BridgeError("BAD_ARGS", "apiKey is required")
        next = { ...now, backend, baseURL, model, ...(apiKey ? { apiKey } : {}) }
      } else {
        const { baseURL: _b, model: _m, ...rest } = now
        next = { ...rest, backend }
      }
      writeConfig(next)
      // A cloud setup still needs the environment, without the local recognizer.
      if (backend === "cloud" && !existsSync(venvDir())) startInstall(false)
      else await restartSidecar()
      return status()
    },
  },
}
