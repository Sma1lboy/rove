import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  addSavedRepo,
  getRepoInitOverride,
  getSavedRepos,
  removeSavedRepo,
  setRepoInitOverride,
  statePath,
} from "../../src/state/repos"

let home: string
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "rove-path-state-"))
  vi.stubEnv("KOBE_HOME_DIR", home)
  vi.stubEnv("ROVE_HOME_DIR", home)
  mkdirSync(path.dirname(statePath()), { recursive: true })
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

it("deduplicates and forgets differently spelled persisted Windows repos", () => {
  writeFileSync(statePath(), JSON.stringify({ savedRepos: ["C:\\path-identity-fixture\\repo"] }))
  expect(addSavedRepo("C:/path-identity-fixture/repo/", { skipGate: true }).added).toBe(false)
  expect(getSavedRepos()).toHaveLength(1)
  expect(removeSavedRepo("C:/path-identity-fixture/repo")).toMatchObject({ removed: true, total: 0 })
})

it("reads and updates the existing repo-init override through a path alias", () => {
  writeFileSync(
    statePath(),
    JSON.stringify({
      repoConfigs: { "C:\\path-identity-fixture\\repo": { initScript: "echo init", initPrompt: "saved" } },
    }),
  )
  expect(getRepoInitOverride("C:/path-identity-fixture/repo")).toMatchObject({ initPrompt: "saved" })
  setRepoInitOverride("C:/path-identity-fixture/repo/", { initPrompt: "updated" })
  expect(getRepoInitOverride("C:\\path-identity-fixture\\repo")).toEqual({
    initScript: "echo init",
    initPrompt: "updated",
  })
})
