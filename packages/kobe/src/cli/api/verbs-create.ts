/**
 * The `create` verb group — spawning new Rove tasks. Split out of `verbs.ts`
 * (file-size cap); spread back into the {@link VERBS} table there, so
 * schema/help/validation see one canonical list.
 */

import { F, FANOUT_CAP } from "./flags.ts"
import { add } from "./handlers-add.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import type { VerbSpec } from "./types.ts"

export const CREATE_VERBS: readonly VerbSpec[] = [
  {
    name: "add",
    summary: `Create a task (shows in the sidebar immediately). With --prompt it also starts the engine and delivers it. PARALLEL ATTEMPTS: --count N spawns N sibling tasks of the SAME prompt, each in its own worktree/branch (--agents claude:2,codex:1 for a mixed fleet); capped at ${FANOUT_CAP}, prefer 3-4. Does NOT steal focus — pass --activate to make it the active task. Alias: spawn-task.`,
    flags: [
      F.repo(),
      F.title(),
      {
        name: "branch",
        type: "string",
        placeholder: "B",
        description: "Explicit branch name (else derived from the title in the repo's own style). Single task only.",
      },
      { name: "base-branch", type: "string", placeholder: "B", description: "Base ref the worktree branches from." },
      F.command(),
      {
        name: "count",
        type: "int",
        placeholder: "N",
        description: `Spawn N sibling tasks of one prompt (parallel attempts, cap ${FANOUT_CAP}). Requires --prompt.`,
      },
      {
        name: "agents",
        type: "string",
        placeholder: "claude:2,codex:1",
        description:
          "Per-ENGINE counts for a mixed parallel round (alternative to --count). Engine ids only — see `engine-list`.",
      },
      {
        name: "status",
        type: "enum",
        values: TASK_STATUSES,
        default: "backlog",
        description: "Initial lifecycle status.",
      },
      { name: "pin", type: "bool", description: "Pin the task to the top of the sidebar." },
      {
        name: "activate",
        type: "bool",
        default: "false",
        description: "Make this the active task (pulls every mounted TUI's Tasks-pane focus). Off by default.",
      },
      F.prompt(
        false,
        "Optional first message — when set, materializes the worktree, starts the engine, and pastes it. Required with --count/--agents.",
      ),
    ],
    handler: add,
  },
]
