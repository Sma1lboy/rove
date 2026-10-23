/**
 * `liveTaskIds` — which tasks own a live hosted session. A migrated child's
 * conversation is a PTY keyed under its parent, so that key is alive FOR THE
 * CHILD: `context` would otherwise refute a running child as stale and credit
 * the parent with a session it does not have.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ handlePtyList: vi.fn() }))

import type * as HandlerHelpers from "../../src/cli/api/handler-helpers.ts"

vi.mock("../../src/cli/api/handler-helpers.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof HandlerHelpers>()),
  handlePtyList: mocks.handlePtyList,
}))

import { defaultApiRuntime } from "../../src/cli/api/runtime.ts"

const tasks = [{ id: "parent" }, { id: "kid", ptyAlias: { taskId: "parent", tabId: "tab-3" } }]

beforeEach(() => {
  mocks.handlePtyList.mockReset()
})

describe("defaultApiRuntime.liveTaskIds", () => {
  it("credits an aliased PTY to the child, not to the parent it is keyed under", async () => {
    mocks.handlePtyList.mockResolvedValue({ sessions: [{ key: "parent::tab-3", alive: true }] })
    expect([...((await defaultApiRuntime.liveTaskIds(tasks)) ?? [])]).toEqual(["kid"])
  })

  it("still credits the parent for its own tabs, and ignores dead sessions", async () => {
    mocks.handlePtyList.mockResolvedValue({
      sessions: [
        { key: "parent::tab-1", alive: true },
        { key: "parent::tab-3", alive: false },
      ],
    })
    expect([...((await defaultApiRuntime.liveTaskIds(tasks)) ?? [])]).toEqual(["parent"])
  })

  it("is null, not empty, when the pty host cannot be asked", async () => {
    mocks.handlePtyList.mockResolvedValue({ sessions: null })
    await expect(defaultApiRuntime.liveTaskIds(tasks)).resolves.toBeNull()
  })
})
