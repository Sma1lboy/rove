/**
 * Field guard for the Automations store — the same class of bug that shipped
 * twice on `Task` (`observedLanguage`): `create()` persists via `...input`
 * spread, but `normalizeAutomation` rebuilds the record field-by-field on
 * load, so a new optional field works perfectly until the daemon restarts and
 * is then silently gone. `update()` is a third hand-written list with the
 * same failure mode.
 *
 * Same technique as `serialize-task-fields.test.ts`: `DeepRequired` makes the
 * fixture name every field at compile time, so adding an optional to
 * `Automation` or `AutomationPatch` breaks the build here until it is listed,
 * and the assertion then goes red until the loader / patch applier carry it.
 */

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AutomationsStore } from "../../../kobe-daemon/src/daemon/automations-store.ts"
import type { Automation, AutomationPatch } from "../../../kobe-daemon/src/daemon/contracts.ts"

type DeepRequired<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string | number | boolean
    ? NonNullable<T[K]>
    : DeepRequired<NonNullable<T[K]>>
}

const NOW = new Date(2026, 6, 31, 10, 0, 0).getTime()

/** Every field the store can carry, each with a distinguishable value. The
 *  store owns id/nextRunAt/createdAt/updatedAt, so those are omitted on
 *  create and read back from what it returned. */
const FULL: Omit<DeepRequired<Automation>, "id" | "nextRunAt" | "createdAt" | "updatedAt" | "target"> = {
  name: "nightly audit",
  repo: "/repo",
  prompt: "run the audit",
  vendor: "codex",
  schedule: "0 9 * * *",
  precheck: { command: "git fetch --dry-run", timeoutSeconds: 45 },
  baseRef: "release/1.x",
  persistentSession: true,
  sessionTaskId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  enabled: true,
  missedRunGraceMinutes: 15,
  lastOccurrenceAt: "2026-07-30T09:00:00.000Z",
}

/** Every patch key, each with a value that differs from FULL. `null` keys are
 *  exercised separately below, so this fixture uses the set-a-value form. */
const PATCH: Omit<DeepRequired<AutomationPatch>, "target"> = {
  name: "renamed",
  prompt: "run the other audit",
  vendor: "claude",
  schedule: "*/15 * * * *",
  precheck: { command: "true", timeoutSeconds: 5 },
  baseRef: "main",
  enabled: false,
  missedRunGraceMinutes: 120,
  persistentSession: false,
  sessionTaskId: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
}

const BOUND: DeepRequired<Pick<Automation, "target">> = {
  target: { kind: "existing-tab", taskId: "external-task", tabId: "tab-2" },
}

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "kobe-automations-fields-")), "automations.json")
}

describe("Automation field round-trip", () => {
  it("binding, preserving and clearing the target survive separate daemon restarts", async () => {
    const path = tempPath()
    const store = new AutomationsStore(path, () => NOW)
    await store.init()
    const created = await store.create(FULL)
    await store.update(created.id, { ...BOUND, vendor: null, baseRef: null, persistentSession: false })
    await store.update(created.id, { name: "bound" })
    const rebound = new AutomationsStore(path, () => NOW)
    await rebound.init()
    expect(rebound.get(created.id)).toMatchObject(BOUND)
    expect(rebound.get(created.id)).not.toHaveProperty("vendor")
    expect(rebound.get(created.id)).not.toHaveProperty("sessionTaskId")
    await rebound.update(created.id, { target: null })
    const cleared = new AutomationsStore(path, () => NOW)
    await cleared.init()
    expect(cleared.get(created.id)).not.toHaveProperty("target")
  })

  it("every field survives create → daemon restart → get", async () => {
    const path = tempPath()
    const store = new AutomationsStore(path, () => NOW)
    await store.init()
    const created = await store.create(FULL)

    const reborn = new AutomationsStore(path, () => NOW)
    await reborn.init()
    // Whole-object equality: a field the loader forgets shows up as a missing
    // key, not as a passing test that only checked the keys it knew about.
    expect(reborn.get(created.id)).toEqual(created)
    expect(created).toMatchObject(FULL)
  })

  it("every AutomationPatch key mutates through update()", async () => {
    const store = new AutomationsStore(tempPath(), () => NOW)
    await store.init()
    const created = await store.create(FULL)
    const updated = await store.update(created.id, PATCH)
    expect(updated).toMatchObject(PATCH)
    // Sanity: the fixture really did change every key, or a no-op update
    // would pass toMatchObject against values it never touched.
    for (const key of Object.keys(PATCH) as (keyof typeof PATCH)[]) {
      expect(created[key], key).not.toEqual(PATCH[key])
    }
  })

  it("nullable patch keys clear the field on disk, not just in memory", async () => {
    const path = tempPath()
    const store = new AutomationsStore(path, () => NOW)
    await store.init()
    const created = await store.create(FULL)
    await store.update(created.id, { precheck: null, baseRef: null, sessionTaskId: null })

    const reborn = new AutomationsStore(path, () => NOW)
    await reborn.init()
    const loaded = reborn.get(created.id)
    expect(loaded).not.toHaveProperty("precheck")
    expect(loaded).not.toHaveProperty("baseRef")
    expect(loaded).not.toHaveProperty("sessionTaskId")
  })
})
