/**
 * Decision-gate verbs: a task asks its owner a question, the owner's answer
 * routes back into the engine tab. Specs spread into {@link VERBS}.
 */

import { F } from "./flags.ts"
import { gateAnswer, gateRaise, gateWithdraw, gates } from "./handlers-gates.ts"
import type { VerbSpec } from "./types.ts"

export const GATE_VERBS: readonly VerbSpec[] = [
  {
    name: "gate-raise",
    group: "drive",
    summary:
      "Ask the OWNER a question only they can answer, instead of burying it in a MEMO or report. Opens a decision gate: it shows in their Inbox as `decision_needed` and in `gates`; their answer is pasted back into this tab as `[ROVE GATE g-N answered] …`. Raising counts as ending your turn on a blocker — ask, then stop and wait for the answer. Returns { gate } with the `g-N` id.",
    flags: [
      F.taskId(true),
      {
        name: "tab",
        type: "string",
        placeholder: "tab-N",
        description:
          "Tab the answer is pasted into. Default: the tab you are running in (when it is this task's), else the task's first engine tab.",
      },
      {
        name: "question",
        type: "string",
        required: true,
        placeholder: "TEXT",
        description: "The question, ≤ 500 chars. Make it answerable without opening the task.",
      },
      {
        name: "option",
        type: "string",
        repeatable: true,
        placeholder: "KEY=LABEL",
        description:
          "A choice the owner can pick, e.g. `--option a=ship-now --option b=wait`. Up to 6; omit for a free-text-only question.",
      },
      {
        name: "recommend",
        type: "string",
        placeholder: "KEY",
        description: "The option key you recommend; shown marked in the owner's dialog.",
      },
      {
        name: "context",
        type: "string",
        placeholder: "TEXT",
        description: "≤ 4000 chars: why it matters and what each option costs.",
      },
    ],
    handler: gateRaise,
  },
  {
    name: "gate-answer",
    group: "drive",
    summary:
      "Answer an open decision gate. The answer is saved first, then pasted into the gate's tab; with no live engine the gate is answered but `handoff: undelivered`, and the next prompt sent to that tab carries it. Pass --option (must be one of the gate's keys), --text, or both. Returns { gate, delivered }.",
    flags: [
      {
        name: "gate",
        type: "string",
        required: true,
        placeholder: "g-N",
        description: "Gate id (from `gates`).",
      },
      { name: "option", type: "string", placeholder: "KEY", description: "The chosen option's key." },
      { name: "text", type: "string", placeholder: "TEXT", description: "Free-text answer, or a note to an option." },
    ],
    handler: gateAnswer,
  },
  {
    name: "gate-withdraw",
    group: "drive",
    summary:
      "Withdraw an open decision gate that no longer needs an answer (the question went moot). Deleting a task withdraws its gates automatically.",
    flags: [{ name: "gate", type: "string", required: true, placeholder: "g-N", description: "Gate id." }],
    handler: gateWithdraw,
  },
  {
    name: "gates",
    group: "read",
    summary:
      "List decision gates. Default: the open ones — questions waiting on the owner. `--status answered` shows answered gates, whose `.handoff` says whether the engine has the answer (`undelivered` = it rides the next prompt to that tab).",
    flags: [
      F.repo(false),
      F.taskId(false),
      {
        name: "status",
        type: "enum",
        values: ["open", "answered", "withdrawn", "all"],
        default: "open",
        description: "Which gates to list.",
      },
    ],
    handler: gates,
  },
]
