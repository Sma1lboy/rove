import { expect, test } from "vitest"
import { type BinaryDiscoveryDeps, BinaryNotFoundError } from "../../src/engine/binary-discovery"
import { findBobBinary } from "../../src/engine/bob-local/binary"
import { findClaudeBinary } from "../../src/engine/claude-code-local/binary"
import { findCodexBinary } from "../../src/engine/codex-local/binary"
import { findCopilotBinary } from "../../src/engine/copilot-local/binary"
import { findKimiBinary } from "../../src/engine/kimi-local/binary"
import { findOmpBinary, findPiBinary } from "../../src/engine/pi-local/binary"

const engines = [
  ["bob", findBobBinary],
  ["claude", findClaudeBinary],
  ["codex", findCodexBinary],
  ["copilot", findCopilotBinary],
  ["kimi", findKimiBinary],
  ["pi", findPiBinary],
  ["omp", findOmpBinary],
] as const
const scenarios = [
  { platform: "darwin", env: {} },
  { platform: "linux", env: { NVM_BIN: "/nvm/active/bin" } },
  { platform: "win32", env: {} },
  { platform: "win32", env: { NVM_BIN: "/nvm/active/bin", APPDATA: "/roaming", LOCALAPPDATA: "/local" } },
  { platform: "win32", env: { APPDATA: "/roaming" } },
  { platform: "win32", env: { LOCALAPPDATA: "/local" } },
] satisfies { platform: NodeJS.Platform; env: Record<string, string | undefined> }[]

test.each(engines)("%s preserves its ordered candidate paths", async (_name, find) => {
  const results = []
  for (const scenario of scenarios) {
    const env: Record<string, string | undefined> = scenario.env
    const probes: string[] = []
    const deps: BinaryDiscoveryDeps = {
      home: () => "/home/u",
      env: (key) => env[key],
      platform: () => scenario.platform,
      readdir: () => ["v8.17.0", "v22.1.0", "v18.20.0"],
      which: () => undefined,
      fileExists: (candidate) => {
        probes.push(candidate)
        return false
      },
    }
    await expect(find(deps)).rejects.toBeInstanceOf(BinaryNotFoundError)
    results.push({ ...scenario, probes })
  }
  expect(results).toMatchSnapshot()
})
