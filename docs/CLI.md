# CLI reference

Everything the `rove` and `kobe` binaries do. The scriptable surface for agents and
scripts has its own page: [`rove api`](./API.md).

Two things stay authoritative if this page and the binary ever disagree:
`rove --help` for the command list, and `rove api schema` for the `rove api`
surface.

## Install and update

Needs git and at least one engine CLI on `PATH`. The CLI runs on the Bun
runtime (≥ 1.3.11); each route below installs Bun for you when it is missing.

```bash
curl -fsSL https://rove.run/install.sh | sh   # installs Bun, then Rove
npm install -g @sma1lboy/rove                         # npm (asks about Bun on first run)
bun install -g @sma1lboy/rove                         # bun
npx @sma1lboy/rove                                    # try without installing
```

The `rove` and `kobe` bins are small launchers: they run the CLI directly when
started by Bun, and find (or offer to install) a Bun when started by node,
which is what `npm install -g` and `npx` do. Two environment variables steer
that: `ROVE_BUN` names the Bun binary to use, `ROVE_NO_BUN_BOOTSTRAP=1` turns a
missing Bun into a plain error instead of an install offer.

The installed package exposes both `rove` and `kobe`. `rove` is the canonical
entry point; `kobe` remains a fully supported compatibility alias. They run the
same commands against the same daemon, worktrees, and persisted state. This
rename uses `~/.rove` and `~/.config/rove/state.json` for canonical product
data. First launch migrates supported legacy data from `~/.kobe` (see
[Where state lives](#where-state-lives)).

```bash
rove update            # latest
rove update 0.7.90     # pin a version
rove update list       # browse recent versions (also: --list)
rove update dry-run    # print the command without running it (also: --dry-run)
```

rove updates using whichever package manager owns the `rove` on your `PATH`,
so the new version can't land in a shadowed prefix. Manual fallback:
`npm install -g @sma1lboy/rove@latest`.

Some versions are marked breaking. Installing across one prints a heads-up,
and the next launch asks you to run `rove reset` first. Worktrees are never
touched.

## Launching

```bash
rove            # the TUI (first run: onboarding wizard)
rove .          # open a directory as a task, the `code .` gesture
rove web        # the browser dashboard on http://localhost:45174
```

A typo never silently opens the TUI: an unknown subcommand prints usage and
exits 2.

## All commands

```text
rove <version>

Usage: rove [command] [options]

Run with no command to launch PureTUI.
Run `rove .` (or `rove <path>`) to open a directory as a standalone task.

Commands:
  web [options]           Launch the browser dashboard
  completions <shell>     Generate shell completion script (bash/zsh/fish)
  add [path]              Save a repo path for the new-task picker
  remove [path]           Forget a saved project (inverse of add; non-destructive)
  adopt [glob]            Import existing git worktrees as tasks
  export [--csv|--json]   Print the task list (json/csv/table; daemon-free)
  repo <verb>             Per-repo init script + first prompt (show|set|unset)
  api <verb>              Scriptable RPC surface for agents (see `rove api --help`)
  daemon <verb>           Manage the daemon (start|stop|status|restart)
  doctor [--report|--fix] Diagnose daemon/PTY/engines/git; --fix walks the remedies
  config [--path]         Open Rove's config file (state.json) in your editor
  reset [--hard]          Stop runtimes; optionally wipe task/UI state
  theme <verb>            Manage user themes (list|add|remove)
  skill <verb>            Install the Rove agent skill (install|status|command|print)
  plugin <verb>           Install and run plugins (install|link|list|action|…)
  feedback                Send feedback to GitHub Discussions
  update [version|list]   Self-update Rove, or browse versions with `list`

Options:
  -v, --version           Print version
  -h, --help              Print this help
  --skill                 Print the agent skill file and exit
```

Bare `rove version` and `rove help` work too, as spelled-out forms of the
flags.

## Managing projects

```bash
rove add [path]      # save a repo for the new-task picker (defaults to .)
rove remove [path]   # forget it; files, worktrees, and tasks all stay
rove adopt [glob] [--repo <path>] [--vendor <engine>] [--yes]
                     # list/import existing git worktrees as tasks
```

`rove add` needs a real git repo. It creates the project's sidebar row and
folds in any existing unlinked worktrees as tasks.

`rove adopt` scans the current repo by default; `--repo <path>` selects another
one and `--vendor <engine>` chooses the engine recorded on imported tasks. With
no glob it is a dry run that lists what it would import; pass a glob to filter
(`rove adopt 'feature-*'`) and `--yes` / `-y` to actually do it.

**Remote projects** (experimental; enable Settings → Dev → Experimental
first) can register an SSH host and create task worktrees there:

```bash
rove add --remote --host <host> --user <user> --path <basePath> \
         [--port N] [--key [path] | --password]
```

Auth is either `--key` (ssh-agent when you omit the path) or `--password`.
Password auth is **macOS-only today**: Rove prompts for it and stores only a
reference in `state.json`; the secret lives in the macOS keychain. Linux and
Windows reject `--password`, so use a key or ssh-agent there.

This is not remote-execution parity yet. Remote worktree creation is wired,
but the current Hosted PTY engine launcher does not wrap the engine command in
SSH. A remote-only worktree path therefore cannot be treated like a supported
local engine cwd, and engine launch may fail. Files/diffs and repo init also
lack full remote parity. Do not use this experiment as a security boundary or
assume prompts, engine execution, or repository reads are confined to the SSH
host.

## web

```bash
rove web [--port <n>] [--routes-only] [--no-takeover]
```

(`--bridge-only` is accepted as a legacy alias for `--routes-only`.)

Serves the dashboard on `:45174`, plus a sidecar for browser terminal tabs.
`--routes-only` starts/verifies only the daemon-hosted HTTP/SSE routes, for a
separate Vite dev server. Normally Rove may replace an older Rove PTY sidecar
on `<port + 2>`; `--no-takeover` disables that replacement and never probes or
kills the prior sidecar.

`ROVE_DAEMON_WEB_PORT` is read when the **daemon starts** (`0`/`off`/`false`
disables its web transport). It is not a substitute for `rove web --port`:
`rove web` targets `45174` unless `--port` is present. Neither setting can
rebind a daemon that is already running; after changing the daemon port, run
`rove daemon restart`, then pass the same port to `rove web`.

## completions

```bash
source <(rove completions zsh)
rove completions bash > ~/.bash_completion.d/rove
rove completions fish > ~/.config/fish/completions/rove.fish
```

Completes two levels: the subcommand, then its verb.

```text
rove <TAB>          web completions add remove adopt export repo api daemon …
rove daemon <TAB>   status start stop restart
rove theme <TAB>    list add remove
rove api routine-<TAB>   routine-list routine-create routine-update …
```

`api`, `daemon`, `plugin`, `repo`, `skill` and `theme` carry verbs; the rest
take flags only, and get no second level rather than an invented one. Flags
are never completed — each subcommand owns its own.

Both levels are derived, not transcribed. The `api` verbs come from the same
registry `rove api schema` enumerates, and the other five from a table each
command validates its own argv against — so a verb the CLI accepts but the
completion script omits is not a state the two can reach. Regenerate the
script after upgrading Rove to pick up new verbs.

## export

```bash
rove export [--json | --csv | --format <json|csv|table>]   # --format=<fmt> works too
```

Prints your task list. Read-only and **works with the daemon down**, which is
what makes it different from `rove api list`. Columns: `id, title, status,
archived, vendor, branch, repo, worktreePath`. Default is JSON; `--format
table` aligns it for humans.

## config

```bash
rove config [--path]     # `rove config path` works too
```

Opens `~/.config/rove/state.json` in your editor. See
[Configuration](./CONFIGURATION.md).

## theme

```bash
rove theme list                                  # alias: ls
rove theme add <url|path> [--name|-n <name>] [--force|-f]
rove theme remove <name>                         # alias: rm
```

User themes land in `~/.rove/themes/` and can shadow a bundled name. Bundled
themes can't be removed. See [Themes](./themes.md).

## repo

```bash
rove repo show [path]
rove repo set [path] [--init-script <text> | --init-script-file <path>]
                    [--init-prompt <text> | --init-prompt-file <path>]
                    # at least one of the four
rove repo unset [path] [--init-script] [--init-prompt]
```

Sets a per-user init override for a repo. If the repo commits its own
`.rove/init.sh` / `.rove/init-prompt.md`, those win. Legacy `.kobe` files are
field-by-field fallbacks. Path defaults to the current directory. `unset` with
no flag clears both.

## skill

```bash
rove skill install [--global|-g | --project|-p] [--agent NAME]…
rove skill status
rove skill command [--global|-g | --project|-p] [--agent NAME]…
                                                   # print, don't run
rove skill print                                 # print the SKILL.md itself
```

Installs the Rove agent skill, which teaches a coding agent to drive
`rove api`. Installs are **global** (user-level) by default: the skill
drives a machine-wide daemon, so one copy per machine keeps one staleness
lifecycle; `--project` / `-p` installs into the current project instead.
`--global` / `-g` restates the default explicitly. With no `--agent` it
detects your installed agents and asks. To name them yourself, repeat the flag
(`--agent claude-code --agent codex`; `--agent=codex` also works); a
comma-joined list is rejected rather than silently using only the first.

The SKILL.md ships inside the npm package, so no repo clone is needed; the
install itself still runs `npx skills add` (which falls back to a repo clone
only if the bundled copy is missing).

`rove --skill` (top-level flag) is shorthand for `rove skill print`: it dumps
the bundled SKILL.md to stdout so an agent can learn the `rove api` surface in
one command, e.g. prompt your agent with ``read `rove --skill` then fan out
tasks``, no pre-installed skill required.

## plugin

```text
rove plugin install <owner/repo[/subdir]> [--yes] [--ref <rev>]
rove plugin link <dir>                         register a local directory (dev)
rove plugin list                               installed + linked plugins
rove plugin search [query]                     browse the marketplace
rove plugin outdated                           check installs against upstream
rove plugin update <id…> | --all [--yes]       reinstall stale plugins
rove plugin enable <id> | disable <id>         toggle without unregistering
rove plugin unlink <id>                        unregister a linked plugin
rove plugin uninstall <id-or-spec>             unregister + remove the checkout
rove plugin config-dir <id>                    print its config directory
rove plugin log <id> [-n <count>]              tail its command log (default 20)
rove plugin action list [--plugin <id>]
rove plugin action invoke <plugin-id.action-id> [args…]
rove plugin pane open <plugin-id.pane-id> [--task <task-id>]
rove plugin pane open --plugin <id> --entrypoint <pane-id>   # equivalent form
```

Changes apply to a running daemon without a restart. Writing one:
[Plugin authoring](./PLUGIN-AUTHORING.md). Marketplace:
<https://github.com/topics/rove-plugin>. Repositories carrying the legacy
`kobe-plugin` topic remain included.

## doctor

```bash
rove doctor [--report] [--fix]
```

Read-only check of your build, terminal, git, engine CLIs and logins, daemon,
running sessions, agent skill, and state files. The plain run never changes
anything. `--report` also writes a bug bundle (diagnosis + recent logs + env)
and prints its path; attach that to bug reports.

`--fix` walks the remedies for whatever the diagnosis found, one at a time:

- **Safe fixes run after a per-fix `y/N`** — each shows the exact command
  before asking (e.g. `rove daemon restart` for a stale/dead daemon or a dead
  hook channel, `rove skill install` for a missing/stale agent skill). Nothing
  is batched; declining one fix never skips the next prompt.
- **Risky remedies are printed, never executed** — anything that kills live
  sessions (`rove reset`, closing engine tabs) or needs a human (installing
  git/Node.js, engine logins) is shown with the step and why doctor won't run
  it. Without a TTY (`--fix` in a script), nothing at all is executed.

The remedies mirror [Troubleshooting](./TROUBLESHOOTING.md) — `--fix` is that
page's executable half.

## reset

```bash
rove reset [--hard] [--yes]
```

Recovers a wedged install: stops the daemon and the PTY host (ending all
background sessions), and also stops any pre-v0.8 tmux sessions the retired
runtime left behind. **Never touches git worktrees.** `--hard` also deletes
your task index and UI state. Asks for confirmation unless `--yes`.

## daemon

```bash
rove daemon status     # status JSON; exit 1 when nothing is running
rove daemon start      # run in the FOREGROUND (this process becomes it)
rove daemon stop
rove daemon restart    # stop, then respawn in the background
```

Bare `rove daemon` defaults to `status`.

The daemon auto-starts when the TUI or `rove api` needs it, so `start` is
mainly for debugging. Logs are at `~/.rove/daemon.log`; read them first when
something's wrong.

> **Working on Rove itself?** Run `rove daemon restart` after editing
> daemon/orchestrator/engine code. Bun doesn't hot-reload.

## feedback

```bash
rove feedback --title <text> (--body <text> | --body-file <path>) [--category <slug>]
```

Opens a GitHub Discussion via the `gh` CLI (needs `gh auth login`).
`--body-file -` reads from stdin. `--category` defaults to `feedback`.

## Internal subcommands

Not in `--help`, listed so they aren't a mystery if you see them:

- **`rove pty-host`.** The process that owns embedded terminals so they
  survive TUI exits and daemon restarts. Spawned automatically.
- **`rove hook <verb>`.** Fired by an engine's own hooks to report activity.
  It always exits 0 and never starts the daemon, so it can't fail your engine.
  Two verbs are user-facing: **`rove hook cleanup`** removes Rove's
  settings-managed hooks from `~/.claude/settings.json` after the Claude Code
  plugin takes over (see
  [Configuration → Claude Code plugin](CONFIGURATION.md#claude-code-plugin)),
  and **`rove hook setup`** is a deprecated no-op kept so old instructions
  fail loud instead of silently.

## Exit codes

- **0.** Success, including "already in that state" (`daemon stop` with no
  daemon).
- **1.** Runtime failure: `rove add` on a non-repo, no editor found, no
  daemon for `daemon status`, plugin errors.
- **2.** Bad invocation: unknown command, verb, or flag; missing value.
  Always comes with usage text.

`rove api` is the JSON-first surface (JSON on stdout, a JSON error envelope on
stderr). Everything else prints human text. For machine-readable task data
without a daemon, use `rove export --json`.

## Environment variables

`ROVE_*` is the canonical spelling. Every one of these also accepts the
established `KOBE_*` name as a compatibility alias, and `ROVE_*` wins when both
are set: `ROVE_HOME_DIR` beats `KOBE_HOME_DIR`, `ROVE_OPEN_EDITOR` beats
`KOBE_OPEN_EDITOR`, and so on for the whole table.

| Variable | What it does |
|---|---|
| `ROVE_HOME_DIR` | Move Rove's home-rooted task/runtime data; platform settings and engine-owned history keep their own locations |
| `ROVE_OPEN_EDITOR` | Command that opens a worktree in a GUI editor (`code`, `cursor`, …) |
| `ROVE_DAEMON_WEB_PORT` | Daemon web-transport port at daemon startup (default 45174; `0`/`off`/`false` disables). `rove web` itself uses `--port`. |
| `ROVE_WEB_HOST` | Host the daemon binds its web transport to, read at daemon startup |
| `ROVE_DEV=1` | Mark a developer checkout; hides the update chip |
| `ROVE_DEBUG=1` | Print full startup errors instead of one line |
| `ROVE_TASK_ID` / `ROVE_TAB_ID` | Set inside tabs Rove opens; how `rove api` verbs resolve the calling task |

The `KOBE_*` aliases stay fully supported: engine hooks and older automation
keep reading `KOBE_TASK_ID` / `KOBE_TAB_ID`, which Rove exports beside the
canonical names.

`ROVE_OPEN_EDITOR` wins over Rove's auto-detection, and it's separate from the
`editor.*` settings, which pick your TTY editor.

## Where state lives

Canonical product data under `~/.rove/` (or `ROVE_HOME_DIR`, with
`KOBE_HOME_DIR` as fallback):

- `tasks.json`: the task index
- `worktrees/<repo-key>/<task-slug>/`: per-task worktrees (unless relocated by
  Settings → General → Worktree location)
- `themes/`, `settings/keybindings.yaml`, issues, notes, and automations

Plus `~/.config/rove/state.json`, the settings file `rove config` or
`kobe config` opens. Existing `~/.kobe/worktrees` paths remain recognized and
are never copied or rewritten. Daemon/PTY runtime files (sockets, pidfiles,
logs) and the plugin tree are canonical under `~/.rove/`; a legacy `~/.kobe`
path is honoured only while a pre-rename daemon, PTY host, or plugin registry
is still live, and after binding on the new paths Rove leaves symlinks at the
old ones so older binaries still find the running daemon. The first launch
copies supported legacy state additively and never overwrites canonical files
— except the plugin tree (`plugins.json`, `plugins/<id>/`), which is *moved*
with a compatibility symlink left behind. Daemon-owned stores are copied at
new-daemon startup, only after the legacy writer has stopped.
