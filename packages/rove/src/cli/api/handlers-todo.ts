/**
 * `todo` — a task's notes and checklist, the owner's review list that sits beside the work.
 *
 * The same copy the TUI, the web Files panel and a phone read: one `task.notes` RPC, whose ops the daemon
 * applies together. No flag at all just reads.
 */

import { type TaskTodo, type TodoOp, todoCount } from "@sma1lboy/rove-daemon/task-notes"
import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"
import { resolveTarget } from "./verbs-edit.ts"

async function todo(ctx: VerbContext): Promise<unknown> {
  const { args } = ctx
  const taskId = await resolveTarget(ctx, "todo")
  const add = args.str("add")
  const check = args.str("check")
  const uncheck = args.str("uncheck")
  const edit = args.str("edit")
  const text = args.str("text")
  const remove = args.str("remove")
  const notes = args.bool("clear-notes") === true ? "" : args.str("notes")
  if ((edit === undefined) !== (text === undefined)) {
    throw new ApiError("--edit ID and --text T go together", "BAD_FLAG")
  }
  const ops: TodoOp[] = [
    ...(add !== undefined ? [{ op: "add", text: add } as const] : []),
    ...(check !== undefined ? [{ op: "check", id: check, done: true } as const] : []),
    ...(uncheck !== undefined ? [{ op: "check", id: uncheck, done: false } as const] : []),
    ...(edit !== undefined && text !== undefined ? [{ op: "edit", id: edit, text } as const] : []),
    ...(remove !== undefined ? [{ op: "remove", id: remove } as const] : []),
  ]
  const after = await simpleRpc<{ notes?: string; todos: readonly TaskTodo[] }>(ctx, "task.notes", {
    taskId,
    ...(notes !== undefined ? { notes } : {}),
    ...(ops.length > 0 ? { ops } : {}),
  })
  const count = todoCount(after.todos)
  return {
    ok: true,
    taskId,
    notes: after.notes ?? "",
    todos: after.todos,
    done: count?.done ?? 0,
    total: count?.total ?? 0,
  }
}

export const TODO_VERB: VerbSpec = {
  name: "todo",
  group: "edit",
  summary:
    "Read or change a task's notes and checklist — the owner's own review list (shown in the web Files panel's Notes tab and as `done/total` on the task row). With no flag it lists them. Flags combine in one call and apply together, in this order: --add, --check, --uncheck, --edit/--text, --remove; one refused op (TODO_NOT_FOUND, TODO_EMPTY, TODO_TOO_LONG, TODO_LIMIT) changes nothing. A todo id is `t<N>` as listed. Default target: the calling session's own task. Returns { ok, taskId, notes, todos: [{ id, text, done }], done, total }.",
  flags: [
    {
      ...F.taskId(false),
      description: "Target task id (from `list` / `add`). Default: the calling session's own task.",
    },
    {
      name: "add",
      type: "string",
      placeholder: "TEXT",
      description: "Add an unchecked todo (one line, up to 500 characters; 100 per task).",
    },
    { name: "check", type: "string", placeholder: "ID", description: "Mark todo ID done." },
    { name: "uncheck", type: "string", placeholder: "ID", description: "Mark todo ID not done." },
    { name: "edit", type: "string", placeholder: "ID", description: "Change todo ID's text to --text." },
    { name: "text", type: "string", placeholder: "TEXT", description: "The new text for --edit." },
    { name: "remove", type: "string", placeholder: "ID", description: "Delete todo ID." },
    {
      name: "notes",
      type: "string",
      placeholder: "TEXT",
      description: "Replace the task's free-text notes (up to 20000 characters); Use --clear-notes to empty them.",
    },
    { name: "clear-notes", type: "bool", description: "Empty the free-text notes." },
  ],
  handler: todo,
}
