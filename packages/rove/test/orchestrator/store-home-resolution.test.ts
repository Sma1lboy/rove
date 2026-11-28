/**
 * Which HOME a `new TaskIndexStore()` with no options resolves to.
 *
 * The seam against `store-legacy-layout.test.ts` is one level up: that file
 * fixes which FILE inside a home answers, this one fixes which HOME. It exists
 * because the failure is silent and lands on the wrong machine's data — the
 * CLI's daemon-down write fallback (`openLocalOrchestrator`) and `rove export`
 * both construct this store with no options, so a constructor that skipped the
 * env wrote an isolated environment's tasks into the operator's real
 * `~/.rove/tasks.json` and reported success.
 */

import { join } from "node:path"
import { TaskIndexStore } from "@sma1lboy/rove-core/orchestrator/index/store.ts"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("home resolution with no explicit homeDir", () => {
  it("uses ROVE_HOME_DIR", () => {
    vi.stubEnv("ROVE_HOME_DIR", "/tmp/rove-home-resolution/rove")
    expect(new TaskIndexStore().filePath).toBe(join("/tmp/rove-home-resolution/rove", ".rove", "tasks.json"))
  })
})
