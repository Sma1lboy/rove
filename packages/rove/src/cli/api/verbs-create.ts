/**
 * The `create` verb group — spawning new Rove tasks. One file per
 * `VerbGroup`, mirroring the taxonomy `rove api schema --group create` prints
 * — though it is each spec's own `group` field, not this file, that decides
 * where a verb lists. Specs spread back into the
 * {@link VERBS} table, so schema/help/validation see one canonical list.
 */

import { F, FANOUT_CAP } from "./flags.ts"
import { add } from "./handlers-add.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import type { VerbSpec } from "./types.ts"

export const CREATE_VERBS: readonly VerbSpec[] = [
  {
    name: "add",
    group: "create",
    summary: `Create a task (shows in the sidebar immediately). With --prompt it also starts the engine and delivers it. PARALLEL ATTEMPTS: --count N spawns N sibling tasks of the SAME prompt, each in its own worktree/branch (--agents claude:2,codex:1 for a mixed fleet); capped at ${FANOUT_CAP}, prefer 3-4. NESTING (children never nest): called from a verified rove session ($ROVE_TASK_ID/$ROVE_TAB_ID that the pty host confirms), the new task becomes a CHILD of the caller's top-level task and shows under it in the sidebar — but only when its repo is that task's own repo and that task is not a routine session; otherwise (another repo, --machine, an unverifiable env, a daemon or routine caller) it stays top level, never an error. --parent ID nests under that task instead, in any repo; --no-parent opts out; --count/--agents siblings all get the parent; \`dispatcher\` still records the exact calling task and tab. A child in the parent's repo cuts its worktree from the parent's CURRENT branch tip (a \`dir\` task inside a git repo gets a worktree at the repo root and runs in the same relative subdirectory) instead of the repo default — unless --base-branch, --fork or several --repo name the fork point. \`parentDirty:true\` in the reply means the parent has uncommitted changes the new worktree does not carry; \`sharedLinks\` lists the parent workspace's top-level symlinks to OTHER git checkouts, which a new worktree does not isolate (--isolate-in LINK cuts the worktree in the linked repo instead). --no-worktree shares the parent's directory instead of cutting a worktree (read-only parallel work: two engines writing one tree will collide); it and --isolate-in need a parent (MISSING_TARGET without one). The child's bare \`send\` replies to the session that added it; \`.task.parentTaskId\` (and \`.task.sharesWorkspaceOf\` for a shared child) say where it landed. Does NOT steal focus — pass --activate to make it the active task. The sidebar shows .task.title and .task.branch — name a task by those (or its id), never by the directory in .task.worktreePath, which the UI never renders. \`.engine\` ({ vendor, command, model, effort }; per row with --count/--agents) is what the task actually launches once the flags and the repo default are resolved — check it before trusting the run. \`.warnings\` flags a --model that plainly belongs to another engine's vendor (e.g. codex given a claude-* id); the task is still created. Alias: spawn-task.`,
    flags: [
      {
        name: "repo",
        type: "string",
        required: true,
        repeatable: true,
        placeholder: "PATH|REPO",
        description:
          "Repo root (git toplevel; relative paths resolve against $PWD), or a repo id: `owner/name` (GitHub), `host/owner/name`, or a remote URL. An id resolves to this machine's checkout of it (the primary one, else a clean one) — or, with --machine, to that machine's. REPEAT it for a multi-repo task (max 8, all local): the FIRST is the primary — the engine's cwd, the sidebar project, `.task.repo/.branch/.worktreePath` — and each further one gets its own worktree on the SAME branch name (suffixed `-2` only in a repo where the name is taken), listed in `.task.extraRepos[]` ({ name, repo, branch, worktreePath, baseRef }; paths fill in once the worktrees exist). The engine sees the extras through its add-dir flag where it has one, `$ROVE_TASK_REPOS` / `$ROVE_REPO_<NAME>` env, and a note on the first prompt. `--count` gives every sibling the same repo set. Errors: TOO_MANY_REPOS, REPO_DUPLICATE, NOT_A_GIT_REPO (names the repo), REMOTE_EXTRA_UNSUPPORTED.",
      },
      {
        name: "clone",
        type: "bool",
        description:
          "With a repo id this machine (or --machine's) has no checkout of: clone it into ~/.rove/repos/<host>/<owner>/<name> first.",
      },
      {
        name: "fork",
        type: "string",
        placeholder: "TASK_ID",
        description:
          "Fork that task: the new task is a sibling in the SAME repo whose worktree is a copy-on-write clone of the parent's, so it starts with the parent's uncommitted edits, staged changes, untracked files and gitignored dirs (node_modules, build output), on a new branch rooted at the parent's HEAD. The clone is made during this call and is instant on APFS (macOS) or a reflink filesystem (btrfs, XFS); it costs no disk until either side writes. Replaces --repo (taken from the parent; --repo, --base-branch, --base-for, --count and --agents conflict with it: CONFLICTING_FLAGS). Title defaults to '<parent title> (fork)'. Refused with FORK_UNSUPPORTED — nothing created — when the parent is a main or directory task, is multi-repo or remote, or its worktree sits on a volume that cannot clone files; the parent is never modified. Scratch state the parent keeps in its git directory (a half-done merge or rebase) does not come along.",
      },
      {
        name: "workspace",
        type: "enum",
        values: ["layerfs"],
        description:
          "EXPERIMENTAL, Linux only: put the task's files in a LayerFS Workspace inside a per-task Docker sandbox instead of a git worktree (`experimental.layerfs` in state.json names its env file; Store calls need passwordless sudo). Terminals run inside the sandbox at the task's path; checkpoint/rewind use LayerFS commits; `export-branch` brings its git branch back for landing. Refused with LAYERFS_UNAVAILABLE / LAYERFS_NEEDS_ROOT — nothing created — when it cannot run here. Conflicts with --fork, --count, --agents, --no-worktree, --isolate-in and extra repos (CONFLICTING_FLAGS); inside a session it still nests under the caller, as its own layerfs task rather than a worktree cut from the parent.",
      },
      {
        name: "allow-fork",
        type: "bool",
        description:
          "With --machine: accept a checkout there that shares the repo's history under another origin (a fork).",
      },
      {
        name: "parent",
        type: "string",
        placeholder: "ID",
        description:
          "Nest the new task under this task (stored under its top-level ancestor), whatever its repo — the rules of `update --parent`. Default: the verified calling session, when the repo is its own; see the summary. PARENT_NOT_FOUND if no such task.",
      },
      {
        name: "no-parent",
        type: "bool",
        description:
          "Create a top-level task even from inside a rove session. Conflicts with --parent, --no-worktree and --isolate-in (CONFLICTING_FLAGS).",
      },
      {
        name: "no-worktree",
        type: "bool",
        description:
          "Share the parent's directory instead of cutting a worktree. The parent is --parent or the calling session; the child takes its repo, so --repo, --fork, --base-branch, --base-for, --branch, --worktree-name, --count, --agents and --isolate-in conflict with it.",
      },
      {
        name: "isolate-in",
        type: "string",
        placeholder: "LINK",
        description:
          "Name of a top-level symlink in the parent's workspace that points at another git checkout (see `sharedLinks`): cut the worktree in THAT repo and run the child there. NOT_A_LINKED_REPO when it is not one. Needs a parent; --repo, --fork, --base-for and --no-worktree conflict with it.",
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
        name: "base-for",
        type: "string",
        repeatable: true,
        placeholder: "REPO=REF",
        description:
          "Per-repo base for a multi-repo task: REPO is the repo's name (its directory name, `-2`-suffixed on a clash; `.task.extraRepos[].name`) or its path, REF the ref its worktree branches from. Repeatable. --base-branch stays the primary's base; naming the primary here too is an error unless they agree.",
      },
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
]
