import { afterAll, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installState, voiceSetup, writeConfig } from "../src/ops/voice-setup.ts"

const saved = process.env.ROVE_VOICE_HOME
let home = ""

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "voice-setup-"))
  process.env.ROVE_VOICE_HOME = home
})

afterAll(() => {
  process.env.ROVE_VOICE_HOME = saved
})

const job = (pid: number, log: string) => {
  writeFileSync(join(home, "install.json"), JSON.stringify({ pid }))
  writeFileSync(join(home, "install.log"), log)
}

test("the install job's state survives the page: read from its log and pid, not from a request", () => {
  expect(installState()).toEqual({ phase: "idle", line: null })

  // Still running: the download bar's latest redraw is the progress line.
  job(process.pid, "Resolved 43 packages\nweights.npz:  12%|█\rweights.npz:  57%|████")
  expect(installState()).toEqual({ phase: "running", line: "weights.npz:  57%|████" })

  job(process.pid, "downloading x\ninstalled x\n__exit 0\n")
  expect(installState().phase).toBe("done")

  job(process.pid, "error: No space left on device\n__exit 1\n")
  expect(installState()).toEqual({ phase: "failed", line: "error: No space left on device" })

  // The job died without its exit line (killed, machine slept and restarted): failed, not forever running.
  const gone = 2 ** 22 + 12345
  job(gone, "downloading x\n")
  expect(installState().phase).toBe("failed")
  rmSync(home, { recursive: true, force: true })
})

test("a saved cloud key stays on the Mac: the file is 0600 and status only says one is set", () => {
  writeConfig({
    backend: "cloud",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini-transcribe",
    apiKey: "sk-secret-123",
  })
  expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600)
  const setup = voiceSetup()
  expect(setup.cloud).toEqual({ baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini-transcribe", hasKey: true })
  expect(JSON.stringify(setup)).not.toContain("sk-secret-123")
  rmSync(home, { recursive: true, force: true })
})
