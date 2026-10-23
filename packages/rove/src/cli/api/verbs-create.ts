/**
 * The `create` verb group — spawning new Rove tasks. One file per
 * `VerbGroup`, mirroring the taxonomy `rove api schema --group create` prints
 * — though it is each spec's own `group` field, not this file, that decides
 * where a verb lists. Specs spread back into the
 * {@link VERBS} table, so schema/help/validation see one canonical list.
 */

import { F, FANOUT_CAP } from "./flags.ts"
import { add } from "./handlers-add.ts"
import { spawn } from "./handlers-spawn.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import type { VerbSpec } from "./types.ts"

export const CREATE_VERBS: readonly VerbSpec[] = [
  {
    name: "add",
    group: "create",
    summary: `Create a task (shows in the sidebar immediately). With --prompt it also starts the engine and delivers it. PARALLEL ATTEMPTS: --count N spawns N sibling tasks of the SAME prompt, each in its own worktree/branch (--agents claude:2,codex:1 for a mixed fleet); capped at ${FANOUT_CAP}, prefer 3-4. Does NOT steal focus — pass --activate to make it the active task. The sidebar shows .task.title and .task.branch — name a task by those (or its id), never by the directory in .task.worktreePath, which the UI never renders. \`.engine\` ({ vendor, command, model, effort }; per row with --count/--agents) is what the task actually launches once the flags and the repo default are resolved — check it before trusting the run. \`.warnings\` flags a --model that plainly belongs to another engine's vendor (e.g. codex given a claude-* id); the task is still created. Alias: spawn-task.`,
    flags: [
      {
        name: "repo",
        type: "string",
        required: true,
        placeholder: "PATH|REPO",
        description:
          "Repo root (git toplevel; relative paths resolve against $PWD), or a repo id: `owner/name` (GitHub), `host/owner/name`, or a remote URL. An id resolves to this machine's checkout of it (the primary one, else a clean one) — or, with --machine, to that machine's.",
      },
      {
        name: "clone",
        type: "bool",
        description:
          "With a repo id this machine (or --machine's) has no checkout of: clone it into ~/.rove/repos/<host>/<owner>/<name> first.",
      },
      {
        name: "allow-fork",
        type: "bool",
        description:
          "With --machine: accept a checkout there that shares the repo's history under another origin (a fork).",
      },
      F.title(),
      {
        name: "branch",
        type: "string",
        placeholder: "B",
        description: "Explicit branch name (else derived from the title in the repo's own style). Single task only.",
      },
      { name: "base-branch", type: "string", placeholder: "B", description: "Base ref the worktree branches from." },
      {
        name: "worktree-name",
        type: "string",
        placeholder: "NAME",
        description:
          "Name the worktree DIRECTORY instead of taking one from the animal pool — so the caller can predict `.task.worktreePath` (`<worktrees root>/<NAME>`) rather than reading it back with get-task. One path segment of letters/digits/`.`/`_`/`-`, not starting with `.` (INVALID_WORKTREE_NAME otherwise). A name already in use in this repo — by a live task, a directory on disk, or a concurrent create — is REFUSED with WORKTREE_NAME_TAKEN, never silently suffixed `-v2`. Single task only.",
      },
      F.command(),
      {
        name: "effort",
        type: "string",
        placeholder: "LEVEL",
        description:
          "Reasoning effort for the FIRST session, not just later ones. Validated against the engine's declared levels (codex: none/low/medium/high/xhigh/max; pi and OMP: off/minimal/low/medium/high/xhigh/max; claude declares none) — free-form, since a plugin engine may declare its own. With --agents, every engine in the plan must declare it.",
      },
      {
        name: "tier",
        type: "enum",
        values: ["swift", "standard", "deep", "auto"],
        description:
          "Auto-routing tier: fills the engine, model and effort from the table in Settings → Auto routing (autoRouting.<tier>.* in state.json) and records the tier on the task (.task.tier). Exclusive with --command/--model/--effort/--agents (CONFLICTING_FLAGS). A tier whose target cannot start — engine not in engine-list, not logged in, model or effort its engine cannot carry — is refused up front (TIER_UNAVAILABLE) with the reason. `auto` asks the classifier named by `autoRouting.classifier` (OFF by default — nothing is sent anywhere until you set it, and with `jev` the prompt goes to TypeSafe, a third party that is not your engine vendor) to read --prompt and pick the tier; needs --prompt/--prompt-file, and NEVER fails the create — off, no key, a timeout, or an answer below `autoRouting.classifierThreshold` all create the task with the ordinary defaults and say so in `.tierAuto`.",
      },
      {
        name: "model",
        type: "string",
        placeholder: "MODEL",
        description:
          "Model for the FIRST session and every rebuild, in the engine's own spelling (claude alias/full id, codex slug, pi/omp pattern or provider/id) — passed verbatim, so `engine-list`'s `models` are suggestions, not a closed list. Rejected (BAD_MODEL) on an engine that declares no model flag; with --agents, every engine in the plan must.",
      },
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
        name: "require-report",
        type: "bool",
        description:
          "Hold every `send` to this task, and its first --prompt, to a report: each arms a delivery the agent closes with `report --delivery <id>`, and a turn that ends without one raises a `report_missing` Inbox row. For tasks ticked unattended. Change later with `update --require-report on|off`.",
      },
      {
        name: "expect-report",
        type: "bool",
        description:
          "Arm a delivery for this task's first --prompt only (as `send --expect-report` does for a send); later sends are not armed.",
      },
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
      F.promptFile(),
    ],
    handler: add,
  },
  {
    name: "spawn",
    group: "create",
    summary:
      "Spawn a CHILD task of the calling session (or --parent): a second conversation that shows under its parent. Default = its own git worktree, branch cut from the parent's CURRENT branch tip (a main checkout's HEAD; a `dir` task inside a git repo gets a worktree at the repo root and runs in the same relative subdirectory; a `dir` outside any repo fails NOT_A_GIT_REPO — never a silent fallback to a shared directory). --no-worktree shares the parent's directory instead (read-only parallel work: two engines writing one tree will collide). The child always runs on the parent's machine, with the parent's engine unless --command says otherwise. Uncommitted changes are NOT carried into a new worktree: `parentDirty:true` in the reply means the parent has some, so commit first if the child needs them. `sharedLinks` lists the workspace's top-level symlinks to OTHER git checkouts, which a new worktree does not isolate (edits under them still land in the one shared repo); --isolate-in LINK cuts the worktree in the linked repo instead (NOT_A_LINKED_REPO if LINK is not such a link). With --prompt the child's engine starts and the brief is delivered; the child's bare `send` replies to the spawning session. Returns { taskId, task, parentDirty, sharedLinks } (+ delivery fields with --prompt); the task carries `.parentTaskId` and, for a shared child, `.sharesWorkspaceOf`.",
    flags: [
      {
        name: "parent",
        type: "string",
        placeholder: "ID",
        description:
          "Task to spawn under. Default: the calling session, from the verified $ROVE_TASK_ID/$ROVE_TAB_ID (an unverifiable env is MISSING_TARGET, never a guess).",
      },
      {
        name: "worktree",
        type: "bool",
        default: "true",
        description:
          "Give the child its own worktree, cut from the parent's current branch tip (default). `--worktree=false` is `--no-worktree`.",
      },
      {
        name: "no-worktree",
        type: "bool",
        description: "Share the parent's directory instead of cutting a worktree.",
      },
      {
        name: "base-branch",
        type: "string",
        placeholder: "B",
        description: "Cut the new worktree from this ref instead of the parent's current tip.",
      },
      {
        name: "isolate-in",
        type: "string",
        placeholder: "LINK",
        description:
          "Name of a top-level symlink in the parent's workspace that points at another git checkout (see `sharedLinks`): cut the worktree in THAT repo and run the child there. NOT_A_LINKED_REPO when it is not one.",
      },
      F.title(),
      F.command(),
      F.prompt(
        false,
        "Optional first message — when set, starts the child's engine and pastes it, prefixed with who spawned it.",
      ),
      F.promptFile(),
    ],
    handler: spawn,
  },
]
