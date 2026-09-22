/**
 * Cursor's hooks.json merge — the pure half of the first contrib-engine hook
 * adapter. Cursor's file nests differently from Claude's/Codex's (flat
 * `{ command }` entries, no inner `hooks` array), so these pin the three
 * properties a best-effort installer that runs on EVERY launch has to hold:
 * it is idempotent, it never touches somebody else's entry, and it recognizes
 * its own entry by OWNERSHIP rather than by literal text — a dev checkout and
 * a released build spell the same hook differently and must not stack up.
 */

import { join } from "node:path"
import { ROVE_HOOK_VERSION } from "@/engine/json-hooks"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CursorHookAdapter,
  cursorHooksPath,
  mergeCursorHooks,
  parseCursorHooks,
} from "../../src/engine/cursor-local/hook-adapter.ts"

const PROD = ["rove"]
const DEV = ["bun", "/repo/packages/kobe/src/cli/rove.ts"]
/** A third party's entry in the same file. */
const FOREIGN = { command: "bash '/Users/x/.cursor/peer-agent-state.sh' session" }

function sessionStart(doc: Record<string, unknown>): unknown[] {
  return ((doc.hooks as Record<string, unknown>).sessionStart ?? []) as unknown[]
}

describe("mergeCursorHooks", () => {
  it("installs one sessionStart entry into an empty document, stamped with the version", () => {
    const doc = mergeCursorHooks({}, true, PROD)
    expect(doc.version).toBe(1)
    // Two versions on this row, and they are different things: `doc.version`
    // is cursor's own file-schema marker, `--hook-version` is which shape of
    // Rove wrote the entry (`engine/integration-status.ts` reads it back).
    expect(sessionStart(doc)).toEqual([
      { command: `rove hook session-start --engine cursor --hook-version ${ROVE_HOOK_VERSION}` },
    ])
  })

  it("replaces a dev-checkout install with the released one instead of stacking", () => {
    const dev = mergeCursorHooks({}, true, DEV)
    expect(sessionStart(dev)).toEqual([
      {
        command: `bun /repo/packages/kobe/src/cli/rove.ts hook session-start --engine cursor --hook-version ${ROVE_HOOK_VERSION}`,
      },
    ])
    expect(sessionStart(mergeCursorHooks(dev, true, PROD))).toEqual([
      { command: `rove hook session-start --engine cursor --hook-version ${ROVE_HOOK_VERSION}` },
    ])
  })

  it("preserves a third party's entry, other events, and other top-level keys", () => {
    const before = {
      version: 1,
      permissions: { allow: ["*"] },
      hooks: { sessionStart: [FOREIGN], beforeShellExecution: [{ command: "audit.sh" }] },
    }
    const after = mergeCursorHooks(before, true, PROD)
    expect(sessionStart(after)).toEqual([
      FOREIGN,
      { command: `rove hook session-start --engine cursor --hook-version ${ROVE_HOOK_VERSION}` },
    ])
    expect((after.hooks as Record<string, unknown>).beforeShellExecution).toEqual([{ command: "audit.sh" }])
    expect(after.permissions).toEqual({ allow: ["*"] })
  })

  it("removal takes only Rove's entry and drops the event when nothing is left", () => {
    const shared = mergeCursorHooks({ hooks: { sessionStart: [FOREIGN] } }, true, PROD)
    expect(sessionStart(mergeCursorHooks(shared, false, PROD))).toEqual([FOREIGN])
    const ours = mergeCursorHooks({}, true, PROD)
    expect((mergeCursorHooks(ours, false, PROD).hooks as Record<string, unknown>).sessionStart).toBeUndefined()
  })
})

describe("parseCursorHooks", () => {
  it("refuses what it cannot merge into, with a reason naming the path", () => {
    expect(parseCursorHooks("{oops")).toMatchObject({ ok: false })
    expect(parseCursorHooks("[]")).toEqual({ ok: false, reason: "top level is not a JSON object" })
    expect(parseCursorHooks('{"hooks":[]}')).toEqual({ ok: false, reason: '"hooks" is not an object' })
    expect(parseCursorHooks('{"hooks":{"sessionStart":"nope"}}')).toEqual({
      ok: false,
      reason: '"hooks.sessionStart" is not an array',
    })
  })
})

describe("cursorHooksPath", () => {
  // `join`, not a literal — the separator is the platform's, and a
  // "/home/x/.cursor/hooks.json" spelling passes everywhere except the
  // Windows CI job.
  afterEach(() => vi.unstubAllEnvs())

  it("defaults under the home directory", () => {
    vi.stubEnv("CURSOR_CONFIG_DIR", "")
    expect(cursorHooksPath("/home/x")).toBe(join("/home/x", ".cursor", "hooks.json"))
  })

  it("honours cursor's own CURSOR_CONFIG_DIR override", () => {
    vi.stubEnv("CURSOR_CONFIG_DIR", join("/elsewhere", "cursor"))
    expect(cursorHooksPath("/home/x")).toBe(join("/elsewhere", "cursor", "hooks.json"))
  })
})

/**
 * A real `sessionStart` payload, traced out of cursor-agent 2026.09.15-d2fe57e
 * by registering a hook that dumps its stdin. Two things in it are why this
 * adapter needs its own readers: the hook process's cwd was `~/.cursor` and
 * there is NO `cwd` key, so the workspace only exists in `workspace_roots`;
 * and `transcript_path` is null even though the field is present.
 */
const REAL_SESSION_START = {
  conversation_id: "98187bc5-36d5-405c-8374-a9dbcc08ca67",
  generation_id: "98187bc5-36d5-405c-8374-a9dbcc08ca67",
  model: "default",
  is_background_agent: false,
  session_id: "98187bc5-36d5-405c-8374-a9dbcc08ca67",
  hook_event_name: "sessionStart",
  cursor_version: "2026.09.15-d2fe57e",
  workspace_roots: ["/repo/worktrees/lion"],
  user_email: "someone@example.com",
  transcript_path: null,
} satisfies Record<string, unknown>

describe("CursorHookAdapter payload readers", () => {
  const adapter = new CursorHookAdapter()

  it("reads the workspace out of workspace_roots, since cursor sends no cwd", () => {
    expect(REAL_SESSION_START).not.toHaveProperty("cwd")
    expect(adapter.cwdFromPayload(REAL_SESSION_START)).toBe("/repo/worktrees/lion")
  })

  it("answers nothing rather than guessing when there is no usable root", () => {
    expect(adapter.cwdFromPayload({})).toBeUndefined()
    expect(adapter.cwdFromPayload({ workspace_roots: [] })).toBeUndefined()
    expect(adapter.cwdFromPayload({ workspace_roots: [null, ""] })).toBeUndefined()
    expect(adapter.cwdFromPayload({ workspace_roots: "/not/an/array" })).toBeUndefined()
  })

  it("takes the session id and omits a null transcript_path", () => {
    expect(adapter.sessionFromPayload(REAL_SESSION_START)).toEqual({
      sessionId: "98187bc5-36d5-405c-8374-a9dbcc08ca67",
    })
  })

  it("falls back to conversation_id on a payload that predates session_id", () => {
    expect(adapter.sessionFromPayload({ conversation_id: "c1" })).toEqual({ sessionId: "c1" })
    expect(adapter.sessionFromPayload({})).toBeUndefined()
  })
})
