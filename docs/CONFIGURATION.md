# Configuration

Most settings are written for you by the Settings dialog. Press `ctrl+a`,
then `,`. This page is for when you want to edit them by hand.

## Where things live

| Path | What | Written by |
|---|---|---|
| `~/.config/rove/state.json` | All your preferences, as flat JSON | Rove (Settings, CLI); yours to hand-edit |
| `~/.rove/themes/*.json` | Installed themes | `rove theme add`, or drop files in |
| `~/.rove/settings/keybindings.yaml` | Keybinding overrides | You only |
| `<repo>/.rove/init.sh` + `init-prompt.md` | Per-repo worktree setup | You (committed to the repo) |
| `<repo>/.rove/pr-instructions.md` | Per-repo PR action prompt | You (committed to the repo) |

Setting `ROVE_HOME_DIR` changes the home beneath these paths. `KOBE_HOME_DIR`
remains a supported fallback; when both are set, `ROVE_HOME_DIR` wins. On first
launch, Rove copies missing client-owned data from `.kobe` and `.config/kobe`;
daemon-owned stores are copied when the new daemon starts, after the old writer
has stopped. Neither phase overwrites old files. Existing worktrees stay
where they are; daemon/PTY runtime files keep their compatibility paths only
while a pre-rename process is still live, and the plugin tree is *moved* into
`~/.rove/` on the first new-daemon start, with a symlink left at the old
path.

### Runtime path overrides

`ROVE_HOME_DIR` already decides where the daemon and the PTY host put their
socket and pidfile, so most people never touch these. Four variables move one
file each, for the case the home cannot cover: running a second Rove *beside*
the one you use, without the two finding each other.

| Variable | Moves |
|---|---|
| `ROVE_DAEMON_SOCKET_PATH` | The socket the daemon listens on, and clients connect to |
| `ROVE_DAEMON_PID_PATH` | The daemon's pidfile (what `rove daemon stop` reads) |
| `ROVE_PTY_SOCKET_PATH` | The PTY host's socket — a named pipe on Windows |
| `ROVE_PTY_PID_PATH` | The PTY host's pidfile |

Each has a `KOBE_`-prefixed fallback (`KOBE_DAEMON_SOCKET_PATH`, and so on);
when both spellings are set, the `ROVE_` one wins. Unset ones stay derived
from the home.

Set them **as a group**, in the same command as `ROVE_HOME_DIR`. Isolating the
home alone still leaves the two processes on the paths they were given, and a
half-isolated instance either refuses to start (`already served by the daemon
on …`) or, worse, drives the terminals of the instance you are using:

```sh
env ROVE_HOME_DIR=/tmp/scratch-home \
    ROVE_DAEMON_SOCKET_PATH=/tmp/scratch-home/daemon.sock \
    ROVE_DAEMON_PID_PATH=/tmp/scratch-home/daemon.pid \
    ROVE_PTY_SOCKET_PATH=/tmp/scratch-home/pty.sock \
    ROVE_PTY_PID_PATH=/tmp/scratch-home/pty.pid \
    rove daemon restart
```

A socket path that is too long for the platform is shortened automatically; a
pidfile path is used as given. See
[Troubleshooting](TROUBLESHOOTING.md#rove-says-the-daemon-serves-a-different-home)
for what a half-applied override looks like from the outside.

## Editing settings

```sh
rove config          # open state.json in your editor
rove config --path   # just print the path
```

rove uses your configured editor (`editor.kind` below) unless it is `auto`
(the default), which honors `$VISUAL` / `$EDITOR`, then the first installed
of nvim, vim, emacs, nano.

Restart Rove to apply a hand edit everywhere.

**Hand-editing is safe.** Unknown keys are ignored and bad values fall back to
defaults, so a typo can't wedge the app; worst case a preference resets. If
the file becomes invalid JSON, Rove renames it to
`state.json.corrupt-<timestamp>` and starts fresh rather than deleting it.
Rove serializes each complete read, mutation, and atomic write with the
state-file lock, so concurrent processes changing different keys preserve
both changes. A whole-state reset takes the same lock and intentionally
replaces all keys. Hand edits do not participate in this lock; finish editing
before changing settings in another Rove process.

Corruption backup also takes the write lock and re-reads the file before
renaming it. A reader that cannot immediately acquire the lock returns defaults
without moving the file, allowing an active writer to finish its repair.
Writers wait up to five seconds for contention and then report failure. The UI
retains unsuccessful dirty-key patches for its next flush; CLI writes report
the error instead of claiming the setting was saved.

## Settings reference

Keys not listed here are internal UI state (saved repos, tab layouts) that
happen to share the file. Three exceptions worth knowing: `repoConfigs` is what
`rove repo set` writes (a map of git toplevel → `{initScript, initPrompt}`,
see [Per-repo init](#per-repo-init)); `lastSelectedVendor` is the legacy
engine fallback below `defaultVendor`; and `externalWorktreeSync` is not a
setting you configure but a cleanup marker Rove writes — it records where the
retired worktree-sync hook was once installed so the next launch (or
`rove hook cleanup`) can remove it, flipping to `"off"` once cleaned.

### Appearance

| Key | Type | Default | What it does |
|---|---|---|---|
| `activeTheme` | theme name | `"claude"` | See [Themes](#themes) |
| `transparentBackground` | boolean | `true`, `false` on Windows | Let the terminal background show through. In transparent mode Rove detects the terminal's actual background (OSC 11) and adjusts body, muted, and host-backed warning text to stay readable on it. Warning text on opaque dialogs and controls keeps the theme color. No setting is needed. Windows starts opaque because Windows Terminal ships acrylic and background images on by default, and a transparent Rove has no opaque surface to scrub stale glyphs against — set it to `true` to turn transparency on there, and a value you have already chosen is never overwritten |
| `focusAccent` | `primary` \| `success` \| `info` | `primary` | Color of the focused-pane indicator |
| `appearance.splitStyle` | `box` \| `line` | `box` | `box` frames each split; `line` is the minimal tmux-style look |
| `locale` | `en` \| `zh` | `en` | UI language |
| `hints.keyboard.enabled` | boolean | `true` | Keyboard discoverability hints |
| `hints.keyboard.prefixTapPresentation` | `local` \| `guide` | `local` | One tap of the prefix key always opens the full keyboard guide. This picks what comes with it: `local` also shows shortcut badges beside the clickable controls already on screen, `guide` hides those badges |

Turning keyboard hints back on relights the first-use pane hints you'd
already dismissed.

### Editor

`editor.kind` and `editor.customCommand` control the file tree's `enter`
action and `rove config`. Opening an entire worktree (`o` in the sidebar or
`ctrl+a` `o`) uses the separate GUI/workspace opener described below.

| Key | Type | Default | What it does |
|---|---|---|---|
| `editor.kind` | `auto` \| `vim` \| `nvim` \| `nano` \| `emacs` \| `custom` | `auto` | `auto` honors `$VISUAL`/`$EDITOR`, then auto-detects |
| `editor.customCommand` | string | unset | Command for `custom`, e.g. `code -w` |

In `editor.customCommand`, `{file}` is replaced by the quoted file path. Without
it, the path is appended.

Set `ROVE_OPEN_EDITOR` to choose the GUI editor for a whole worktree, for
example `ROVE_OPEN_EDITOR=zed`. `KOBE_OPEN_EDITOR` remains a compatibility
fallback; when both are set, `ROVE_OPEN_EDITOR` wins. Without either variable,
Rove tries the `code`, `cursor`, `windsurf`, and `zed` CLIs in that order,
then the platform opener. These variables do not change the file tree's
per-file TTY editor.

The Files pane watches the worktree so edits appear without a keypress. Set
`ROVE_FILETREE_WATCH=0` to turn that watcher off — worth doing on a repo large
enough that a recursive watcher costs more than the staleness it removes. With
it off, `r` is the only thing that repopulates the list.

### Engines

| Key | Type | Default | What it does |
|---|---|---|---|
| `defaultVendor` | engine id | `"claude"` | Default engine for new tasks |
| `engineCommand.<id>` | string | built-in | Launch command, e.g. `"engineCommand.claude": "claude --model opus"` |
| `engineName.<id>` | string | built-in | Display name |
| `customEngineIds` | string[] | `[]` | Your own engines; see [Custom engines](#custom-engines) |
| `engineProtocol.<id>` | built-in engine id | unset | Adapter a custom engine borrows; see [Custom engines](#custom-engines) |
| `lastActiveVendor.<repo>` | engine id | unset | Per-project last used; outranks `defaultVendor`. Written by Rove |

Launch commands are parsed shell-ish, so quotes group arguments. Clear both
`engineName.<id>` and `engineCommand.<id>` to reset an engine to its default.

### Terminal and tabs

| Key | Type | Default | What it does |
|---|---|---|---|
| `terminal.scrollbackRows` | number | `1000` | History per embedded terminal. Clamped 100–100,000 |
| `chat.tabStrip.mode` | `always` \| `multipleOnly` \| `never` | `never` | Horizontal chat tab strip |

The tab strip is off by default: the sidebar tree already lists every tab and
marks the active one, so the strip spends a row of the content pane saying
what the tree says for free. `always` shows it, `multipleOnly` shows it only
once a task has more than one tab. (An older
`chat.tabStrip.hideSingle` boolean still works if you set it before
`chat.tabStrip.mode` existed; writing the new key retires it.)

Scrollback changes apply to terminals started *after* the change; live ones
keep the buffer they were born with.

### Notifications

All three default to on.

| Key | Type | What it does |
|---|---|---|
| `notifications.toast.enabled` | boolean | In-TUI completion toasts |
| `notifications.sound.enabled` | boolean | Chime when a background tab finishes |
| `notifications.crossTask.enabled` | boolean | Toasts for tasks you aren't looking at |

Error toasts always show, even with toasts off. See
[Notifications](#notifications-and-sound) for how they're delivered.

### Zen mode

Zen hides the Files pane so the active workspace gets the freed width. The
engine or shell in the workspace remains visible. Toggle with `ctrl+a` `z`.

| Key | Type | Default | What it does |
|---|---|---|---|
| `zen.active` | boolean | `false` | On/off. Persisted, so switching projects keeps you in zen |

Zen always keeps the Tasks rail visible, because the rail also contains the
exit affordance. A `zen.keepTasks` value left in your `state.json` by an older
Rove is ignored; nothing reads or writes it any more.

### Worktree location

By default new worktrees land under `~/.rove/worktrees/<repo-key>/<slug>`.

| Key | Type | Default | What it does |
|---|---|---|---|
| `worktree.basePath` | string | `~/.rove/worktrees` | Where new worktrees go |
| `worktree.basePath.custom` | string | unset | Remembers your last custom path in the TUI |

`worktree.basePath` takes an absolute path, or one starting with the
`$project_dir` token, which expands to each task's project root, so one setting
that gives you a per-project layout. `$project_dir/..` puts worktrees next to
each repo. The token only counts as the **first** segment.

**Only new tasks move.** Existing tasks keep the path they were created with,
including legacy global and repo-local roots. `worktree.basePath` is
local-only: remote (SSH) worktrees go under the *remote project's own* path
at `<project>/.rove/worktrees`, and their existing `.kobe/worktrees` remain
discoverable. No restart needed.

### Sidebar

The current tree sidebar follows persisted project/task order and supports
manual project reordering with `shift+m`. The `t` key switches the task sort
between that persisted order and most-recently-touched; the choice is saved
as `activeSortMode` and read back on startup. Older state files may contain
`tasksPane.projectFilter`; the daemon still mirrors that compatibility value
for background consumers, but the current PureTUI tree does not consume it.

### Experimental

Off by default. These can change without notice.

| Key | What it enables |
|---|---|
| `experimental.remoteProjects` | Lets `rove add --remote` register a NEW project over SSH. Gates that one command only: remote projects already registered keep working — worktree routing and engine launch never read the flag — so turning it off does not disable them |
| `experimental.autoStatus` | Tasks move to `in_progress` and self-report `in_review` |
| `experimental.dispatcher` | Per-repo routing of field notes between sessions |

## Themes

Rove bundles three themes (`claude`, `conductor`, and `tokyonight`) and ten
more are one command away:

```sh
rove theme list
rove theme add https://rove.run/themes/gruvbox.json
rove theme remove gruvbox
```

Available hosted: `catppuccin`, `dracula`, `everforest`, `gruvbox`,
`kanagawa`, `nord`, `opencode`, `osaka-jade`, `rose-pine`, `solarized`.
Preview them at <https://rove.run/themes>.

You can also drop your own `<name>.json` into `~/.rove/themes/`. No
recompile, loaded at boot, and a user theme wins over a bundled one with the
same name. Writing one: [Themes](./themes.md).

## Keybindings

Full vocabulary: [Keybindings](./KEYBINDINGS.md). The configuration surface:

- Edit `~/.rove/settings/keybindings.yaml` by hand (`.yml` is accepted when
  `.yaml` is absent). Rove never writes it.
- Changes **reload live**, no restart. Problems show up as warnings in
  Settings → Keybindings.
- A direct override replaces that binding's whole chord list; `null` or `[]`
  unbinds it. Prefix overrides set second-stroke keys and keep the original
  pane scope. Platform overlays (`darwin:`, …) win per chord.
- A `plugins:` section binds chords to installed plugin panes and actions.
  Rove ships no default plugin chords.
- Unknown ids are ignored with a warning; a typo never breaks the keymap.

## Notifications and sound

Three kinds: `done` (green), `needs_input` (yellow), `error` (red). Yellow and
red outrank green when both fire for the same tab. Three delivery channels:

- **Toasts.** In-TUI, 4.5 seconds. Error toasts always show, even with
  toasts disabled: a failure shouldn't vanish because you turned off
  completion popups.
- **Desktop notification.** Rove emits an OSC 9 escape that iTerm2, kitty,
  WezTerm, and Ghostty turn into a real OS notification; other terminals
  ignore it. Because it travels down the terminal stream, **it reaches you
  over SSH**. No separate switch — it rides the same
  `notifications.sound.enabled` toggle as the chime.
- **Sound.** A short chime when a background tab finishes. Rove uses the
  first player it finds on `PATH` (`ffplay`, `mpv`, `mpg123`, … `afplay`,
  `play`, `aplay`, …). With none installed it's silent and the terminal bell
  is the fallback.

## Custom engines

Built-in engines are `claude`, `codex`, `copilot`, and `kimi`. You can
register any other CLI from **Settings → Engines**, or by hand:

```json
{
  "customEngineIds": ["aider"],
  "engineCommand.aider": "aider --model sonnet",
  "engineName.aider": "Aider"
}
```

Switching an engine OFF in **Settings → Engines** (`space`) records it under
`disabledEngineIds`; it keeps every override and simply stops being offered
when you pick an engine for a task. That covers the headless path too: a
disabled engine is skipped by `rove api add`'s repo default, so switching one
off after using it in a project does not leave that project still launching it.
The global default engine can't be left disabled; switching it off hands the
default to the first engine still on.

Being in `customEngineIds` *is* the registration. There's no other step.
Settings → Engines rejects a blank id, one that shadows a built-in, and one
already registered; it lowercases and trims what you type and accepts the rest.
Keep ids to lowercase letters, digits, `-` and `_`: the id becomes both a
`--command <id>` argument and a key in `state.json`, so a space or a quote in
one makes it awkward to pass and awkward to hand-edit.

A custom engine launches and runs like any other, but Rove deliberately
doesn't guess at its internals — no history reader, no account detection, no
activity hooks, no session resume — unless you declare
`"engineProtocol.<id>"` (one of the built-in ids: `claude`, `codex`,
`copilot`, `kimi`), which borrows that built-in's adapter for transcript
reads and delivery. More in [Engines](./ENGINES.md).

Settings → Engines asks for it while adding the engine — a list of the
built-ins plus **None**, so the generic adapter is something you choose rather
than something a typo leaves you with — and prints the answer under the engine's
row afterwards. Changing it means removing the engine (`x`) and adding it again,
or editing the key here by hand.

## Claude Code plugin

Rove integrates with Claude Code through global activity hooks (so the
sidebar can show working / done / needs-input for every session) and the
companion agent skill. There are two ways to get both, and you should run
exactly one:

- **Default (no action needed)**: every Rove launch idempotently writes its
  hooks into `~/.claude/settings.json`, and `rove skill install` places the
  skill. If `CLAUDE_CONFIG_DIR` is set to a nonblank path, hooks instead go
  into `<CLAUDE_CONFIG_DIR>/settings.json`. This is what most existing installs use.
- **The Claude Code plugin.** One install carries hooks and skill together,
  with no PATH or settings.json involvement:

  ```text
  /plugin marketplace add Sma1lboy/rove
  /plugin install rove@rove
  ```

  The plugin's hook commands call a bundled wrapper by absolute path, so they
  work even when `rove` isn't on the shell's PATH. The bundled skill is
  versioned with the plugin rather than with Rove itself (`/plugin update`
  refreshes both), so Rove's skill staleness prompts step aside while the
  plugin is enabled.

Once Rove sees the plugin enabled, it stops writing the Claude hooks into
`settings.json` on launch. If you were running Rove **before** installing the
plugin, the old settings-managed hooks are still there and every event would
fire twice. Rove warns about this at startup and the fix is one command:

```bash
rove hook cleanup
```

That removes Rove's entries from the active profile's `settings.json`; your
other hooks, including commands in the same group, are preserved. Installation
and cleanup leave invalid or unreadable settings unchanged. They also refuse
non-regular files and files over 8 MiB. JSON rewrites use owner-only read/write
permissions (`0600`). Startup cleanup of retired global hooks uses this same
profile; explicitly saved repository or settings-file cleanup paths still apply.
If you also have a pre-plugin skill copy under
`~/.claude/skills/rove` (or `…/kobe`), delete that directory. The plugin's
bundled copy replaces it. Rove never edits or removes either one silently.

Uninstalling or disabling the plugin reverses the handoff: the next Rove
launch reinstalls the settings-managed hooks automatically.

Only Claude Code is affected. Codex (and other engines') hook integration is
engine-owned and unchanged by the plugin.

## Per-repo init

A repo can ship two files in its own `.rove/` directory:

- **`.rove/init.sh`.** Runs in each new task worktree before the engine
  starts, once per worktree. Use it for `bun install`, direnv, codegen.
- **`.rove/init-prompt.md`.** Sent as the engine's first message.

`init.sh` comes from the repo, and Rove runs it without asking — in the same
shell that then execs the engine, with your account's privileges. That is the
same level of trust you extend by running the repo's own build or test
command, so it is worth a look at `.rove/init.sh` before you create the first
task in a repository you did not write.

Files committed in the repo win over any per-user override you set with
`rove repo set`. Legacy `.kobe/init.sh` and `.kobe/init-prompt.md` remain
field-by-field fallbacks; a `.rove` file wins when both spellings exist —
for `init.sh` the file merely has to exist (even empty), while
`init-prompt.md` must be non-empty to win.

The PR action also reads `.rove/pr-instructions.md` as its prompt template;
`{{branch}}`, `{{targetBranch}}`, `{{dirtyCountSentence}}`, and
`{{upstreamSentence}}` are substituted (unknown `{{…}}` passes through).
It falls back to `.kobe/pr-instructions.md`; when both files are present, the
non-empty `.rove` file wins.
