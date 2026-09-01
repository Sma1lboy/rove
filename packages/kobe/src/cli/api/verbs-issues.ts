/**
 * The `issues` verb group — daemon-owned issue-store CRUD. Operates on the
 * issue store, not on tasks, which is the whole reason it is its own group.
 * One file per `VerbGroup`, mirroring the taxonomy
 * `rove api schema --group issues` prints — though it is each spec's own
 * `group` field, not this file, that decides where a verb lists. Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { issueUpdate } from "./handlers-tasks.ts"
import type { VerbSpec } from "./types.ts"

const ISSUE_STATUSES = ["open", "doing", "hold", "done"] as const
type IssueStatus = (typeof ISSUE_STATUSES)[number]

export const ISSUE_VERBS: readonly VerbSpec[] = [
  {
    name: "issue-list",
    group: "issues",
    summary: "List daemon-owned issues for a repo.",
    flags: [F.repo()],
    handler: (ctx) => simpleRpc(ctx, "issue.list", { repoRoot: ctx.args.requirePath("repo") }),
  },
  {
    name: "issue-create",
    group: "issues",
    summary: "Create a daemon-owned issue for a repo.",
    flags: [
      F.repo(),
      { name: "title", type: "string", required: true, placeholder: "T", description: "Issue title." },
      { name: "body", type: "string", placeholder: "TEXT", description: "Issue body." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "issue.mutate", {
        repoRoot: ctx.args.requirePath("repo"),
        op: { type: "create", title: ctx.args.require("title"), body: ctx.args.str("body") },
      }),
  },
  {
    name: "issue-set-status",
    group: "issues",
    summary: "Set a daemon-owned issue's status.",
    flags: [
      F.repo(),
      { name: "id", type: "int", required: true, placeholder: "N", description: "Issue id." },
      { name: "status", type: "enum", required: true, values: ISSUE_STATUSES, description: "New issue status." },
    ],
    handler: (ctx) =>
      simpleRpc(ctx, "issue.mutate", {
        repoRoot: ctx.args.requirePath("repo"),
        op: { type: "setStatus", id: ctx.args.int("id"), status: ctx.args.requireEnum<IssueStatus>("status") },
      }),
  },
  {
    name: "issue-update",
    group: "issues",
    summary: "Update a daemon-owned issue's title, body, and/or linked task.",
    flags: [
      F.repo(),
      { name: "id", type: "int", required: true, placeholder: "N", description: "Issue id." },
      { name: "title", type: "string", placeholder: "T", description: "New title." },
      { name: "body", type: "string", placeholder: "TEXT", description: "New body." },
      {
        name: "task",
        type: "string",
        placeholder: "TASK_ID",
        description: "Link the issue to this task (kanban: In progress). Pass `none` to unlink.",
      },
    ],
    handler: issueUpdate,
  },
]
