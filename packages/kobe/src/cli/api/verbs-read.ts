/**
 * The `read` verb group — non-mutating queries over tasks, PTYs, and
 * diagnostics. Split out of `verbs.ts` (file-size cap); spread back into the
 * {@link VERBS} table there, so schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { handlePtyList } from "./handler-helpers.ts"
import { AGENT_TURNS_VERB } from "./handlers-agent-turns.ts"
import { DIGEST_VERB } from "./handlers-digest.ts"
import { collect } from "./handlers-fanout.ts"
import { INSPECT_VERB } from "./handlers-inspect.ts"
import { getTask, list } from "./handlers-tasks.ts"
import { READ_OUTPUT_VERB } from "./read-output.ts"
import type { VerbSpec } from "./types.ts"

export const READ_VERBS: readonly VerbSpec[] = [
  { name: "list", summary: "List all tasks (incl. archived). Returns { tasks }.", flags: [], handler: list },
  {
    name: "get-task",
    summary:
      "Read one task's metadata + terminal tabs. `.running` = any hosted engine tab is live; `.tabs[]` (id/kind/vendor/liveVendor/lastTitle/alive) is the discovery read for `send --tab tab-N`; `.task.dispatcher` = the Rove session (task+tab) that created it, when one did.",
    flags: [F.taskId()],
    handler: getTask,
  },
  {
    name: "pty-list",
    summary:
      "List hosted PTY sessions (key, alive, pid, command, live OSC window title). Empty when no pty host runs. Returns { sessions }.",
    flags: [],
    offline: true,
    handler: handlePtyList,
  },
  {
    name: "collect",
    summary:
      "Read-only health snapshot of a parallel round: identity, branch, lineage (.dispatcher, .groupId), .running (pty-host process truth, not a cached status), .activity (daemon engine state + how long it has been in it, null when unknowable), per-tab .tabs with a dead tab's exit cause AND output tail, uncommitted .changes (non-zero = it cannot land), and committed .base (ahead count + diffstat — ahead:0 is the `succeeded but committed nothing` tell). Select with --group (one fan-out round), --repo, or --task-ids.",
    flags: [
      { name: "task-ids", type: "csv", placeholder: "a,b,c", description: "Comma-separated task ids." },
      {
        name: "group",
        type: "string",
        placeholder: "GROUPID",
        description: "Every unarchived task of one fan-out round (the `groupId` that `add --count` returns).",
      },
      F.repo(false),
    ],
    handler: collect,
  },
  // The ruler: an aggregate read over recent tasks + routine runs. Spec +
  // handler in ./handlers-digest.ts.
  DIGEST_VERB,
  AGENT_TURNS_VERB,
  // Production diagnostics aggregate (daemon activity registry + pty
  // sessions with live foreground walk + persisted tab snapshots). Spec +
  // handler in ./handlers-inspect.ts.
  INSPECT_VERB,
  READ_OUTPUT_VERB,
]
