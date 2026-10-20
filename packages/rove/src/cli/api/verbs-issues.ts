/**
 * The `issues` verb group — daemon-owned issue-store CRUD. Operates on the
 * issue store, not on tasks, which is the whole reason it is its own group.
 * One file per `VerbGroup`, mirroring the taxonomy
 * `rove api schema --group issues` prints — though it is each spec's own
 * `group` field, not this file, that decides where a verb lists. Specs spread back into the {@link VERBS} table, so
 * schema/help/validation see one canonical list.
 */

import { ISSUE_STATUSES, type RepoIssues } from "@sma1lboy/rove-daemon/daemon/issues-store"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { issueUpdate } from "./handlers-tasks.ts"
import { csvOf } from "./list-filter.ts"
import type { VerbContext, VerbSpec } from "./types.ts"

/** Filters AND together; with none passed the daemon's response is returned untouched. */
async function issueList(ctx: VerbContext): Promise<unknown> {
  const repoRoot = ctx.args.requireRepo("repo")
  const statuses = csvOf(ctx, "status", ISSUE_STATUSES, "issue-list")
  const needle = ctx.args.str("search")?.trim().toLowerCase()
  if (!statuses && !needle) return simpleRpc(ctx, "issue.list", { repoRoot })
  const state = await daemonOf(ctx).request<RepoIssues>("issue.list", { repoRoot })
  const issues = state.issues.filter(
    (i) =>
      (!statuses || statuses.has(i.status)) &&
      (!needle || i.title.toLowerCase().includes(needle) || i.body.toLowerCase().includes(needle)),
  )
  return { ...state, issues }
}

export const ISSUE_VERBS: readonly VerbSpec[] = [
  {
    name: "issue-list",
    group: "issues",
    summary:
      "List daemon-owned issues for a repo. --status and --search AND together; `nextId` and `skipped` still describe the whole board.",
    flags: [
      F.repo(),
      {
        name: "status",
        type: "csv",
        placeholder: "S1,S2",
        description: `Only issues in these statuses (${ISSUE_STATUSES.join(", ")}).`,
      },
      {
        name: "search",
        type: "string",
        placeholder: "Q",
        description: "Only issues whose title or body contains Q (case-insensitive).",
      },
    ],
    handler: issueList,
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
        repoRoot: ctx.args.requireRepo("repo"),
        op: { type: "create", title: ctx.args.require("title"), body: ctx.args.str("body") },
      }),
  },
  {
    name: "issue-update",
    group: "issues",
    summary:
      "Update a daemon-owned issue's title, body, linked task, and/or status. Title, body and link land in one all-or-nothing write; the status follows as its own change.",
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
      { name: "status", type: "enum", values: ISSUE_STATUSES, description: "New issue status." },
    ],
    handler: issueUpdate,
  },
  {
    name: "issue-delete",
    group: "issues",
    summary:
      "Delete a daemon-owned issue. Removes ONLY the tracker record — a linked task, its branch and its worktree are left untouched. The same `delete` op the kanban page's `d` runs; use `issue-update --status done` when the story was finished rather than abandoned.",
    flags: [F.repo(), { name: "id", type: "int", required: true, placeholder: "N", description: "Issue id." }],
    handler: (ctx) =>
      simpleRpc(ctx, "issue.mutate", {
        repoRoot: ctx.args.requireRepo("repo"),
        op: { type: "delete", id: ctx.args.int("id") },
      }),
  },
]
