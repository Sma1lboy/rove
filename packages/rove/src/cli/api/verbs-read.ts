/**
 * The `read` verb group. Non-mutating is an invariant: agents are told this
 * group is safe for orientation, so any verb that writes belongs in
 * `drive`/`edit`/`lifecycle`. Each spec's own `group` field (not this file)
 * decides its schema group.
 */

import { TASK_ACTIVITY_STATES } from "../../engine/hook-events.ts"
import { ACTIVITY_STATES_DOC } from "./activity-view.ts"
import { F } from "./flags.ts"
import { handlePtyList } from "./handler-helpers.ts"
import { AGENT_TURNS_VERB } from "./handlers-agent-turns.ts"
import { CONTEXT_VERB } from "./handlers-context.ts"
import { DIGEST_VERB } from "./handlers-digest.ts"
import { collect } from "./handlers-fanout.ts"
import { INSPECT_VERB } from "./handlers-inspect.ts"
import { VIEWERS_VERB } from "./handlers-panel.ts"
import { PORTS_VERB } from "./handlers-ports.ts"
import { QUEUE_LIST_VERB } from "./handlers-queue.ts"
import { REVIEW_COMMENTS_VERB } from "./handlers-review-comments.ts"
import { getTask, list } from "./handlers-tasks.ts"
import { WATCH_VERB } from "./handlers-watch.ts"
import { READ_OUTPUT_VERB } from "./read-output.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import type { VerbSpec } from "./types.ts"

export const READ_VERBS: readonly VerbSpec[] = [
  {
    name: "list",
    group: "read",
    summary:
      "List all tasks. Returns { tasks, activeTaskId } — `activeTaskId` is the shared focus verbs default to when --task-id is omitted (null = no active task), the audit read for any implicit-target delivery. Archived tasks are left out unless --archived. Filters AND together: --repo, --status, --activity (comma lists match any value). --fields id,title,status trims each row to those keys. With --activity each task carries the `.activity` it matched; a task whose state Rove cannot read never matches. `unresolvableRepos` beside `tasks` names task repos --repo could not compare.",
    flags: [
      F.repo(false),
      {
        name: "status",
        type: "csv",
        placeholder: "S1,S2",
        description: `Only tasks in these lifecycle statuses (${TASK_STATUSES.join(", ")}).`,
      },
      {
        name: "activity",
        type: "csv",
        placeholder: "A1,A2",
        description: `Only tasks whose engine is in these states (${TASK_ACTIVITY_STATES.join(", ")}). \`permission_needed,error\` = tasks waiting on you.`,
      },
      {
        name: "archived",
        type: "bool",
        description:
          "List ONLY archived tasks (`archive` hides a task from the default list; `unarchive` brings it back).",
      },
      {
        name: "fields",
        type: "csv",
        placeholder: "F1,F2",
        description:
          "Keep only these keys on each task (e.g. `id,title,status,branch`), so a large fleet reads short; a key a task does not carry stays absent. `activeTaskId` and `unresolvableRepos` are unaffected. An unknown name is refused with BAD_FLAG and lists the valid ones.",
      },
    ],
    handler: list,
  },
  {
    name: "get-task",
    group: "read",
    summary:
      "Read one task's metadata + terminal tabs. `.running` = any hosted engine tab is live; `.tabs[]` (id/kind/vendor/liveVendor/lastTitle/alive) is the discovery read for `send --tab tab-N`; `.task.dispatcher` = the Rove session (task+tab) that created it, when one did; `.task.prStatus.checkState` (none|pending|passing|failing|unknown) is Rove's OWN CI truth for the branch's PR — `passing` is what \"CI is green\" means, never a local test run. `.task.worktreePath` is where the files live; the user only ever sees `.task.title` and `.task.branch`, so refer to the task by those.",
    flags: [F.taskId()],
    handler: getTask,
  },
  {
    name: "pty-list",
    group: "read",
    summary:
      "List hosted PTY sessions (key, alive, pid, command, live OSC window title). Returns { sessions }: `[]` = a live pty host with nothing running (the fleet IS idle); `null` = no pty host to ask, so this is `couldn't look` and says NOTHING about what is running.",
    flags: [],
    offline: true,
    handler: handlePtyList,
  },
  {
    name: "collect",
    group: "read",
    summary: `Read-only health snapshot of a parallel round: identity, branch, lineage (.dispatcher, .groupId), .running (pty-host process truth, not a cached status), .activity (engine state + how long it has been in it, null when unknowable), per-tab .tabs with a dead tab's exit cause AND output tail, uncommitted .changes (non-zero = it cannot land; null = could not read git — do NOT treat as clean), and committed .base (ahead count + diffstat — ahead:0 is the \`succeeded but committed nothing\` tell). Select with --group (one fan-out round), --repo, or --task-ids. ${ACTIVITY_STATES_DOC}`,
    flags: [
      { name: "task-ids", type: "csv", placeholder: "a,b,c", description: "Comma-separated task ids." },
      {
        name: "group",
        type: "string",
        placeholder: "GROUPID",
        description: "Every task of one fan-out round (the `groupId` that `add --count` returns).",
      },
      F.repo(false),
    ],
    handler: collect,
  },
  CONTEXT_VERB,
  DIGEST_VERB,
  AGENT_TURNS_VERB,
  INSPECT_VERB,
  READ_OUTPUT_VERB,
  QUEUE_LIST_VERB,
  WATCH_VERB,
  PORTS_VERB,
  VIEWERS_VERB,
  REVIEW_COMMENTS_VERB,
]
