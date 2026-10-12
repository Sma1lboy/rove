/**
 * `report` and `deliveries`: the agent's side of the delivery contract
 * (docs/design/long-run-controls.md). `send --expect-report` and routine
 * dispatch arm a delivery; the prompt names it; the agent closes it here.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  DELIVERY_OUTCOMES,
  DELIVERY_SUMMARY_MAX_CHARS,
  MAX_DELIVERIES_PER_TASK,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import { expandTilde } from "../../lib/path-home.ts"
import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

interface ReportBody {
  readonly delivery?: string
  readonly outcome?: string
  readonly summary?: string
  readonly evidence?: readonly string[]
  readonly next?: string
}

/** `--json PATH|-`: the whole body in one document, for text the shell would mangle. */
function readJsonBody(source: string): ReportBody {
  const raw = readFileSync(source === "-" ? 0 : resolve(process.cwd(), expandTilde(source)), "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ApiError(`--json ${source} is not valid JSON`, "BAD_FLAG")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("--json must be an object: {delivery, outcome, summary, evidence?, next?}", "BAD_FLAG")
  }
  const body = parsed as Record<string, unknown>
  const evidence = body.evidence
  if (evidence !== undefined && (!Array.isArray(evidence) || evidence.some((e) => typeof e !== "string"))) {
    throw new ApiError("evidence must be an array of strings", "BAD_FLAG")
  }
  for (const key of ["delivery", "outcome", "summary", "next"] as const) {
    if (body[key] !== undefined && typeof body[key] !== "string")
      throw new ApiError(`${key} must be a string`, "BAD_FLAG")
  }
  return body as ReportBody
}

const FIELD_FLAGS = ["delivery", "outcome", "summary", "next"] as const

function readBody(ctx: VerbContext): ReportBody {
  const json = ctx.args.str("json")
  const evidence = ctx.args.list("evidence")
  if (json === undefined) {
    return {
      delivery: ctx.args.str("delivery"),
      outcome: ctx.args.str("outcome"),
      summary: ctx.args.str("summary"),
      evidence,
      next: ctx.args.str("next"),
    }
  }
  if (FIELD_FLAGS.some((f) => ctx.args.str(f) !== undefined) || evidence.length > 0) {
    throw new ApiError("pass --json OR the individual flags, not both", "BAD_FLAG")
  }
  return readJsonBody(json)
}

async function report(ctx: VerbContext): Promise<unknown> {
  const body = readBody(ctx)
  if (!body.delivery) throw new ApiError("--delivery is required", "MISSING_FLAG")
  if (!body.outcome || !(DELIVERY_OUTCOMES as readonly string[]).includes(body.outcome)) {
    throw new ApiError(`--outcome must be one of ${DELIVERY_OUTCOMES.join("|")}`, "MISSING_FLAG")
  }
  if (!body.summary?.trim()) throw new ApiError("--summary is required", "MISSING_FLAG")
  if (body.summary.length > DELIVERY_SUMMARY_MAX_CHARS) {
    throw new ApiError(
      `summary is ${body.summary.length} characters; the cap is ${DELIVERY_SUMMARY_MAX_CHARS}`,
      "RESPONSE_TOO_LARGE",
      { hint: "Summarize: lead with the conclusion, put the detail in --evidence (commits, PR urls, paths)." },
    )
  }
  const res = (await simpleRpc(ctx, "delivery.report", {
    deliveryId: body.delivery,
    outcome: body.outcome,
    summary: body.summary,
    ...(body.evidence?.length ? { evidence: body.evidence } : {}),
    ...(body.next ? { next: body.next } : {}),
  })) as { delivery: unknown }
  if (res.delivery === null) {
    throw new ApiError(`no delivery ${body.delivery}`, "DELIVERY_NOT_FOUND", {
      hint: "Copy the id from the [ROVE] report line of the prompt you were given; `deliveries --task-id <id>` lists them.",
    })
  }
  return res
}

export const REPORT_VERB: VerbSpec = {
  name: "report",
  group: "drive",
  summary: `Close the report a delivered prompt asked for. Run it as the LAST step of the turn, before you stop: a turn that ends without it is flagged \`report_missing\` in the owner's Inbox. --delivery is the id in the prompt's [ROVE] / [ROVE ROUTINE] line. Re-reporting replaces the earlier report; a late report on a flagged delivery clears the flag. --summary ≤ ${DELIVERY_SUMMARY_MAX_CHARS} chars; put commits, PR urls, test results and paths in repeatable --evidence, and what the next tick should do in --next. Use --json - (stdin) for text with quotes or backticks.`,
  flags: [
    { name: "delivery", type: "string", placeholder: "ID", description: "Delivery id, e.g. d-41." },
    {
      name: "outcome",
      type: "enum",
      values: DELIVERY_OUTCOMES,
      placeholder: "O",
      description:
        "done = finished what was asked; partial = some of it; blocked = needs the owner or an external fix; failed = tried and could not.",
    },
    { name: "summary", type: "string", placeholder: "TEXT", description: "What was done (or why not)." },
    {
      name: "evidence",
      type: "string",
      placeholder: "X",
      repeatable: true,
      description: "A commit, PR url, test command + result, or file path. Repeat the flag for several.",
    },
    { name: "next", type: "string", placeholder: "TEXT", description: "What the next tick should do." },
    {
      name: "json",
      type: "string",
      placeholder: "PATH",
      description:
        "Read {delivery, outcome, summary, evidence?, next?} as JSON from this file (`-` = stdin) instead of the flags.",
    },
  ],
  handler: report,
}

export const DELIVERIES_VERB: VerbSpec = {
  name: "deliveries",
  group: "read",
  summary: `A task's armed deliveries, newest first (newest ${MAX_DELIVERIES_PER_TASK} are kept): status awaiting|reported|missing, the report (outcome, summary, evidence, next) and, for missing, why (cause turn-complete|turn-failed|engine-dead|stalled + note). The per-tick log a loop prompt should read instead of a growing MEMO file.`,
  flags: [
    F.taskId(true),
    { name: "limit", type: "int", placeholder: "N", description: "At most N entries (default: all retained)." },
  ],
  handler: async (ctx) =>
    simpleRpc(ctx, "delivery.list", {
      taskId: ctx.args.require("task-id"),
      ...(ctx.args.int("limit") !== undefined ? { limit: ctx.args.int("limit") } : {}),
    }),
}
