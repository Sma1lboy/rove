/**
 * The `deferred-*` verbs — the headless half of the TUI's Inbox.
 *
 * `send` into a busy composer does not drop the prompt: the daemon takes
 * ownership of the text and queues a `prompt_deferred` Inbox episode, and the
 * send exits 0 with `deferred` in its JSON. Releasing that episode was a
 * HUMAN action on a screen, which is the right default for someone who is
 * mid-sentence — and a dead end for the caller class this API exists for. A
 * fleet with nobody attached got: the message silently swept 24 hours later,
 * and every subsequent `send` to that tab refused with
 * `DEFERRED_PROMPT_PENDING` in the meantime.
 *
 * These three verbs are the same three actions the Inbox offers — read it,
 * release it, drop it — over the store the Inbox already reads. They do not
 * bypass the delivery gate: `deferred-release` re-runs it, so a composer that
 * is STILL busy retains the record and says so rather than pasting over
 * somebody's half-typed line.
 */

import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/** One record as `deferred-list` reports it (daemon-shaped, ISO timestamps). */
interface DeferredRecordRow {
  readonly id: string
  readonly taskId: string
  readonly tabId: string
  readonly prompt: string
  readonly layer: string
  readonly at: string
  readonly expiresAt: string
}

/** Why a release did not deliver, as `deferredPrompt.release`'s report says. */
interface RetainedRow {
  readonly id: string
  readonly reason: string
  readonly layer?: string
  readonly error?: string
}

interface ReleaseReport {
  readonly kind: "claimed" | "in-flight" | "missing"
  readonly delivered: readonly string[]
  readonly retained: readonly RetainedRow[]
  readonly cleanupPending: readonly { readonly id: string; readonly error: string }[]
}

/** The recovery every "which id?" rejection points at. */
const LIST_STEP = {
  hint: "no deferred prompt has that id — it was already released, dismissed, or swept past its 24h TTL; list what the daemon still holds",
  nextCommandArgs: ["api", "deferred-list"],
} as const

async function deferredList(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.str("task-id")
  const { records } = await daemonOf(ctx).request<{ records: DeferredRecordRow[] }>("deferredPrompt.list", {})
  return { records: taskId ? records.filter((record) => record.taskId === taskId) : records }
}

/**
 * Deliver one held prompt, reporting what actually happened to it.
 *
 * `delivered` is the answer the caller needs and it is OBSERVED — the daemon
 * claims the record, re-runs the delivery gate, and only reports the id as
 * delivered once the paste landed. A record the gate blocks again is RETAINED
 * (still held, still releasable), which is a different outcome from a record
 * that is gone, so neither collapses into the other.
 */
async function deferredRelease(ctx: VerbContext): Promise<unknown> {
  const id = ctx.args.require("id")
  const report = await daemonOf(ctx).request<ReleaseReport>("deferredPrompt.release", { id })
  if (report.kind === "missing") {
    throw new ApiError(`no deferred prompt with id ${id}`, "DEFERRED_PROMPT_NOT_FOUND", { id, ...LIST_STEP })
  }
  if (report.kind === "in-flight") {
    // The daemon's own flush (or another caller) already owns this record.
    // Retrying is safe — the claim is what prevents a double paste — so this
    // is a wait, not a failure.
    return { ok: true, id, delivered: false, reason: "in-flight" }
  }
  const delivered = report.delivered.includes(id)
  const retained = report.retained.find((row) => row.id === id)
  return {
    ok: true,
    id,
    delivered,
    ...(delivered ? {} : { reason: retained?.reason ?? "unknown" }),
    ...(retained?.layer ? { layer: retained.layer } : {}),
    ...(retained?.error ? { error: retained.error } : {}),
    // A delivered prompt whose Inbox pointer could not be deleted is still
    // delivered; saying so stops a caller from reading the leftover record on
    // its next `deferred-list` as "it never went".
    ...(report.cleanupPending.length > 0 ? { cleanupPending: report.cleanupPending } : {}),
  }
}

export const DEFERRED_VERBS: readonly VerbSpec[] = [
  {
    name: "deferred-list",
    group: "drive",
    summary:
      "Every prompt the daemon is holding because the target composer was busy when it arrived — the Inbox, for a caller with no screen. Each record carries its `id` (for deferred-release / deferred-dismiss), the verbatim `prompt`, the `layer` that blocked it, and `expiresAt`: the daemon sweeps a record 24h after it was filed, and a swept prompt is never delivered. Returns { records }.",
    flags: [F.taskId(false)],
    handler: deferredList,
  },
  {
    name: "deferred-release",
    group: "drive",
    summary:
      "Deliver one held prompt now (the Inbox's release action). Re-runs the delivery gate rather than bypassing it, so a composer that is still busy leaves the record held and reports `delivered:false` with the blocking `reason` — retry later. Returns { id, delivered, reason? }; an id the daemon no longer holds is DEFERRED_PROMPT_NOT_FOUND.",
    flags: [
      {
        name: "id",
        type: "string",
        required: true,
        placeholder: "ID",
        description: "Record id from `deferred-list` (or the `deferred.id` a `send` returned).",
      },
    ],
    handler: deferredRelease,
  },
  {
    name: "deferred-dismiss",
    group: "drive",
    summary:
      "Drop one held prompt WITHOUT delivering it, and free its tab's deferred slot (the Inbox's dismiss action). The text is gone — dismiss a message that is no longer wanted, then send the replacement. Returns { dismissed }.",
    flags: [
      {
        name: "id",
        type: "string",
        required: true,
        placeholder: "ID",
        description: "Record id from `deferred-list` (or the `deferred.id` a `send` returned).",
      },
    ],
    handler: async (ctx) => {
      const id = ctx.args.require("id")
      const result = await daemonOf(ctx).request<{ dismissed: boolean }>("deferredPrompt.dismiss", { id })
      if (!result.dismissed) {
        throw new ApiError(`no deferred prompt with id ${id}`, "DEFERRED_PROMPT_NOT_FOUND", { id, ...LIST_STEP })
      }
      return result
    },
  },
]
