# Machines

One Rove watching every computer you code on.

Install Rove on each machine, register the others with `rove machine add`, and
their tasks appear in your sidebar under a row of their own. There is no
"switch to that machine" step — every machine is connected at once, and the
tree is the answer to what is running where.

## What this needs

- Rove installed on **both** machines (`curl -fsSL https://rove.run/install.sh | sh`,
  which installs Bun too). Run in a terminal, `machine add` offers to install
  it on the other one for you. Either side can be native Windows
  ([below](#a-windows-machine)).
- SSH access to the remote one. A `Host` block in `~/.ssh/config` is the usual
  way; Rove reads it rather than replacing it. If no key you have is accepted
  there, `machine add` offers to set one up (below).

Nothing else. Rove opens no ports and adds no authentication of its own: the
remote daemon keeps listening on its private unix socket, and SSH forwards that
socket to yours. SSH *is* the transport and the authentication.

Both machines need a Rove new enough to have machines — an older one reports no
PTY socket in `rove daemon status`, and `machine add` says so rather than
half-connecting.

Your daemon holds the connections, not each window: every open TUI, the web
app and a paired phone read the same machine list from it. While any of them is
open, your daemon counts as one attached window on each machine, so their
daemons stay up for as long as you are looking. Fifteen seconds after the last
one closes, it lets them go.

## Add a machine

```console
$ rove machine add narwhal
rove machine: contacting narwhal…
rove machine: Nahuels-Mac-mini → narwhal (rove 0.9.185 on Nahuels-Mac-mini.local)
```

`add` verifies before it saves: it asks the machine where its daemon listens
(`rove daemon status --json`, starting one there if none is up) and refuses if
the host is unreachable, Rove is not installed, or no daemon can be started.

- **First connection.** If the host key is not in your `known_hosts` yet, `add`
  prints its fingerprints and asks before trusting it. Run from a script (no
  terminal), it prints them and trusts on first use, as `ssh` itself would.
  Hosts reached through `ProxyJump`/`ProxyCommand` are left to ssh.
- **Rove off the PATH.** A Rove installed with bun or nvm is often missing
  from the PATH of `ssh narwhal <command>`, because the rc file that adds it
  only runs for interactive shells. `add` asks the login shell and the usual
  install directories, then remembers that path for the machine. Your rc files
  are not touched.
- **Fixes, not dead ends.** In a terminal, a failure `add` can repair is
  offered as a fix: it shows the exact command, asks, runs it, and tries
  again. `--yes` runs every offered fix without asking.
  - *No key is accepted:* `add` creates `~/.rove/ssh/hub_ed25519`, a key just
    for this Rove, with no passphrase so it can reconnect unattended, and adds
    it to the machine's `~/.ssh/authorized_keys`. You type that machine's
    password once, into ssh. To revoke this Rove's access, delete the line
    ending in `rove-hub@<this host>` there.
  - *Rove is missing:* `add` runs the official install script on the machine
    (`curl -fsSL https://rove.run/install.sh | sh`).
  - *Rove is too old:* `add` runs `rove update` there.
- **When ssh fails**, the message names the cause and the fix: a name that
  does not resolve, a refused or timed-out connection, a rejected key, a host
  key not trusted yet, or one that **changed** (which `add` will not override).
Rove never guesses a remote socket path — the remote home may be a different
user, and the path may have been shortened to fit the platform's socket-name
limit.

The alias is what the sidebar shows. It defaults to the target you typed —
`rove machine add narwhal` gives you a machine called `narwhal`, because that
is the name you already chose for it. A target that is addressing rather than a
name (`user@host`, an explicit port, a bare IP) takes the machine's own
hostname instead. Override either with `--alias`:

```console
$ rove machine add nahuel@mac-mini.local --alias narwhal
```

| Option | What it does |
| --- | --- |
| `--alias <name>` | Local name for the machine. Default: the target you typed, or the machine's hostname when the target is `user@host` / has a port / is an IP. |
| `--port <n>` | SSH port. Default: whatever `ssh_config` says. |
| `--identity <file>` | SSH private key. Default: ssh-agent / `ssh_config`. |

The target is `[user@]host[:port]`, usually just an `ssh_config` `Host` alias.
An IPv6 address with a port needs brackets, exactly as `ssh` requires:
`[fe80::1]:2222`.

Nothing secret is written to `state.json`. A key is stored as a path; a
password is stored as a keychain reference, never as a password.

## What you see

```
rove                          ← your projects, exactly where they were
  main
  fix/machines
narwhal:rove                  ← narwhal's checkout of a repo you also have
  remote probe ☁              ← a task there: the cloud says where it runs
```

There is no row for the machine itself: projects from every machine share one
list, and a task from another machine carries a cloud mark (`on narwhal ·
v0.9.185` on the row the cursor is on).

- **Two machines, one repo name.** A repo called `rove` on both machines shows
  as `rove` here and `narwhal:rove` there. The local one keeps the bare name —
  it is the one you are sitting at. Two checkouts of `rove` on the *same*
  machine take the path instead (`gihub/rove`, `i/rove`): there the machine
  name would say nothing.
- **The web app shows one project per repo.** It knows a repo by its `origin`
  (`github.com/me/rove`), or its first commit when there is no `origin`, not
  by its path. `rove` on this machine and on `narwhal` is one `rove` header
  with a `narwhal` chip, its tasks from both machines underneath. Each task
  still runs on its own machine. Two different repos with one name read
  `me/rove` and `other/rove`.
- **Offline machines keep their rows.** A laptop whose lid closed has not
  stopped having those tasks, so the row stays and greys out instead of
  vanishing. Rove reconnects in the background and the rows come back to life.
- **Version skew is on the row.** `narwhal · v0.9.180` next to your own build
  explains most of what otherwise looks like a bug. A machine whose Rove is too
  old to talk to yours reads `⚠ v0.9.100 (protocol mismatch)` and is the only
  row affected.
- **A machine you cannot see says why on the web.** One with no tasks yet,
  or one that never connected since the daemon started, has no rows at all. The
  web app's rail then lists **Machines** with how many are not connected. That
  page shows each machine's state and version, the cause in words (nothing
  answers SSH, the name does not resolve, the key was refused, Rove is not
  installed there, the link dropped…) and the `rove machine doctor <alias>` to
  run here. It never shows ssh's own message, which can name users, addresses
  and paths, because the web app can be opened from anywhere.

## Check a machine again

```console
$ rove machine doctor
narwhal  ✓  rove 0.9.251 on Nahuels-Mac-mini.local
```

`doctor` re-runs the same checks for every registered machine (or the one you
name) and offers the same fixes, for when something changed underneath: a key
was revoked, Rove was reinstalled somewhere else, the machine was rebuilt. It
also says when a machine runs a different Rove version than this one, and
exits 1 if any machine is not usable.

A Windows machine gets Windows answers: an OpenSSH Server that is off comes
with the PowerShell lines that turn it on, a rejected key with the lines that
authorize this hub's key there (an administrator's key file differs), a
PowerShell profile that prints on every command with how to keep it to your
own logins, and an sshd whose `DefaultShell` is bash or WSL with the reason
you reached that shell's Rove instead of the native one.

## List and remove

```console
$ rove machine list
narwhal  narwhal  Nahuels-Mac-mini.local

$ rove machine remove narwhal
rove machine: removed narwhal. Nothing on that machine was changed — its daemon, tasks and worktrees are untouched.
```

`add` and `remove` take effect in every open window, the web app and a paired
phone within a few seconds; nothing needs a restart.

Registering one machine under two aliases is recognized and reported: Rove
compares the remote daemon's hostname, state root and pid, and renders one row
either way.

## When the other machine cannot reach this one

Registering works in one direction: the machine that runs `machine add` must
reach the other over SSH. To see this machine from the other side too, when
it cannot dial you (a WSL distro behind Windows NAT, a laptop behind a home
router), have this machine keep a reverse tunnel open to it:

```console
$ rove machine tunnel mac --install
rove machine: wrote ~/.config/systemd/user/rove-tunnel-mac.service
rove machine: tunnel to mac is up and restarts on its own. On mac, register this machine with `rove machine add <you>@127.0.0.1:2222`.
```

`127.0.0.1:2222` on `mac` now leads to this machine's sshd. The tunnel runs as
a systemd user service on Linux and a launchd agent on macOS, so it restarts
when the link drops and comes back at login. Without `--install` the command
prints the `ssh -N -R …` line and the service file and changes nothing;
`--uninstall` removes it. `--remote-port` and `--local-port` pick the two
ports (defaults 2222 and 22). This machine still needs an sshd that accepts
the other machine's key; keep it on loopback if nothing else should reach it.

On WSL this needs systemd (`[boot] systemd=true` in `/etc/wsl.conf`, the
Ubuntu default).

## Run commands on a machine

Every `rove api` verb takes `--machine <alias>` and runs in that machine's
daemon, so its tasks, worktrees and engine sessions are created there:

```console
$ rove api add --machine narwhal --repo /home/nahuel/rove --prompt "fix the flaky test"
```

A `--task-id` that belongs to another machine goes there on its own: `send`,
`read-output`, `land` and `delete` work on a remote task the same as on a local
one. Paths are paths on that machine. [API.md](API.md#run-a-verb-on-another-machine)
has the details.

A daemon left running with `rove daemon start --resident` on an always-on box
can be the one you dispatch from: register your machines there, and anything
that reaches that daemon (`rove api`, `rove --web`, the phone apps) can send
work to any of them. That also means a bridge token for that daemon runs
commands on every machine registered there: guard it like an ssh key.

## What other machines may do here

A verb another machine's hub forwards here runs as this machine's own Rove,
so this machine decides what it accepts. Nothing is refused until you say so:

```console
$ rove machine inbound            # the policy, one class per line
$ rove machine inbound deny land  # refuse land/publish from any hub
$ rove machine inbound allow land
```

Classes are the verb groups (`rove api schema --group …`: `read`, `create`,
`drive`, `edit`, `lifecycle`, …) plus `land` for `land` and `publish`, and
`credentials` for the verbs that sign this machine's `gh` in or out
(`github-login`, `github-logout`, `github-sync`, `github-apply`). A
refused call comes back as `INBOUND_DENIED`, naming the class and the hub's
hostname, with the command that lifts it. The policy lives in this machine's
`state.json` (`machineInbound`); the hub has no say in it.

## GitHub credentials

Rove keeps no GitHub token of its own. A machine can use GitHub as far as its
own `gh` is signed in (the token sits in that machine's keychain), and git
pushes through it once `gh auth setup-git` has run. **Rove's account** is the
hub's own `gh` login; Settings → Connectors → GitHub in the web client shows
it, and under it every registered machine with a mark: `✓` the same account,
`⚠ @other` a different one, `✗` signed out, or `gh` missing, Rove there too
old, offline.

- **Connect** runs the device flow on the hub: a code to type at
  github.com/login/device, then `gh` stores the token. When it completes, the
  hub signs in every online machine that is signed out. A machine already on
  another account is never overwritten; its row offers **Use Rove's account**.
- **Log in there** runs the same device flow on that machine.
- **Use Rove's account** (`rove api github-sync --to <alias>`) reads the hub's
  token inside the hub's daemon and hands it to the machine's `gh` over the
  forwarded socket; the machine's `git_protocol` is left as it was. The token
  is not printed, logged or stored by Rove on either side.
- **Disconnect** signs the hub's `gh` out (`github-logout`) for every tool
  that uses `gh`, so the web client asks first.

Signing a machine's credentials in or out is the `credentials` class above:
`rove machine inbound deny credentials` makes a machine refuse all of it
(`INBOUND_DENIED`). Reading a machine's status stays allowed. The same is in
the CLI: `rove api github-status --machine <alias>`.

## Working on a remote task

The web and the TUI open a task on another machine like a local one. Its tabs
are listed from that machine. Its terminal attaches that machine's live
session: you can watch and type, and new and closed tabs happen over there.
The Files pane reads that machine's worktree through the `worktree-files`,
`worktree-diff` and `worktree-diff-file` verbs. Nothing is spawned on the hub
for a remote task. The other machine needs a Rove with those verbs. Opening a
file in an editor or another app stays on the machine that has it, and so does
sync-with-base.

Dispatch names the repo, not a path: `rove api add --machine mac --repo
~/code/rove` finds the Mac's own checkout (`repo-match`, root commit or
origin), and so does `--repo sma1lboy/rove`
([below](#repos-are-named-by-id-not-path)). A base branch with unpushed
commits is refused (`UNPUSHED_BASE`). `land` on a remote task pushes its
branch there and opens a PR (`publish`). `--machine auto` picks the machine
with the fewest tasks in progress among those that have the repo.

## Repos are named by id, not path

A repo's id is its normalized `origin`: `github.com/sma1lboy/rove`, whatever
the remote URL's form. A repo with no origin is `root:<sha>`, its first
commit. A path is only one machine's checkout of it, so `--repo` takes the id
too:

```console
$ rove api add --machine narwhal --repo sma1lboy/rove --prompt "fix the flaky test"
```

`owner/name` means GitHub; `host/owner/name` and any remote URL name other
hosts. A value that could be a path (absolute, `~` or `.` first, or a
directory that exists) stays a path, and a path that is a checkout here is
read as that checkout's repo before it crosses to another machine.

- **Which checkout.** A machine looks through its saved repos and every
  task's repo. With several checkouts of one id, its primary one wins, then a
  clean one (no uncommitted changes to tracked files), then the first found.
- **Forks.** A checkout with the same first commit under another origin is a
  fork. It is never picked silently: dispatch fails with `FORK_MATCH`, naming
  it, and `--allow-fork` accepts it.
- **`--clone`.** When the machine has no checkout (`NO_REMOTE_CHECKOUT`, or
  `NO_LOCAL_CHECKOUT` here), `--clone` has it run `git clone` into
  `~/.rove/repos/<host>/<owner>/<name>` and save it as a repo. A later
  dispatch finds it there. It needs a repo with an origin, and that machine
  must be able to fetch it; otherwise `CLONE_FAILED` carries git's error.
- **`--machine auto`** only considers machines that have the repo, and its
  stderr line names the ones it skipped. When none has it, load alone
  decides. With `--clone`, every machine is a candidate.

Pick the primary checkout on each machine, in that machine's shell:

```console
$ rove machine primary ~/code/rove          # this checkout answers for its repo id
$ rove machine primary                      # list the marks
$ rove machine primary ~/code/rove --clear  # back to clean-then-first
```

The marks live in that machine's `state.json` (`repoPrimary`). To see what a
machine has, by id, with each repo's checkouts and primary:

```console
$ rove api repo-list --machine narwhal
```

The sidebar in `rove --web` groups projects by repo id too: a repo you have
on several machines is one project, with each machine's tasks under it.

The New task composer in `rove --web` has a machine chip that does the same
from the page. Pick a machine and its project list is that machine's
`repo-list`; a typed `owner/repo` or URL, or a repo under "Your GitHub
repositories", is offered as `Clone … on <machine>`, and Start sends
`add --machine <alias> --repo <id> --clone`, so that machine clones with its
own git and `gh` sign-in. A machine that is offline or too old is listed with
its state and cannot be picked.

## A Windows machine

A Windows PC running native Rove registers like any other machine:

```console
$ rove machine add jackson@192.168.1.45 --alias win
```

It needs the OpenSSH Server, which Windows ships but leaves off. In an
elevated PowerShell on that PC:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic; Start-Service sshd
```

The `OpenSSH-Server-In-TCP` firewall rule comes with it; check it with
`Get-NetFirewallRule -Name OpenSSH-Server-In-TCP`.

- **Keys.** For an account in the Administrators group, OpenSSH for Windows
  reads `%ProgramData%\ssh\administrators_authorized_keys`, not
  `~\.ssh\authorized_keys`, and only if nobody but SYSTEM and Administrators
  can read it. Elevated, on that PC, with the hub's public key:

  ```powershell
  Add-Content "$env:ProgramData\ssh\administrators_authorized_keys" '<public key>'
  icacls.exe "$env:ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "*S-1-5-32-544:F" /grant "SYSTEM:F"
  ```

- **Shell.** sshd runs commands in cmd or PowerShell (its `DefaultShell`), and
  Rove sends nothing either would misread. A `rove` that is not on that
  session's PATH is looked for in `%APPDATA%\npm`, `~\.bun\bin` and the user
  PATH, and run through Windows PowerShell.
- **Profile output.** A PowerShell profile that prints (a fastfetch banner) runs
  before every command. Rove skips it, but each connection waits for it. Guard
  it with `if (-not [Console]::IsOutputRedirected) { … }` to keep it for your
  own logins only.
- **Transport.** The daemon socket and the PTY host's named pipe cannot be
  forwarded by ssh, so a hub always reaches a Windows machine through
  `rove daemon relay`, below. The Windows machine needs a Rove that marks
  where its relayed bytes start; an older one is reported as too old.

## What this release does not do yet

- No leader election or failover: every machine owns its own tasks, and any
  machine with the others registered can be the panel. A central scheduler
  would need one.
- The SSH key a hub uses is not restricted to Rove's relay
  (`authorized_keys command=…`).

On native Windows, OpenSSH has no unix-socket forwarding and no connection
multiplexing, so the hub serves each machine's two sockets itself and relays
every connection through `ssh <machine> rove daemon relay` (and `… --pty` for
terminals) over the session's stdin and stdout. A hub does the same for a
Windows machine, whatever the hub runs on. Nothing extra is needed on
either side. Any hub can use the same transport with
`ROVE_MACHINE_TRANSPORT=stdio`, for a host whose sshd refuses `streamlocal`
forwarding.

## Where things live

| Path | What |
| --- | --- |
| `state.json` → `machines` | The registry: host, user, port, auth, learned identity |
| `state.json` → `repoPrimary` | Repo id → this machine's primary checkout (`rove machine primary`) |
| `<home>/.rove/repos/<host>/<owner>/<name>` | Where `--clone` puts a repo it fetches |
| `<home>/.rove/machines/<alias>/daemon.sock` | Local end of the forwarded daemon socket |
| `<home>/.rove/machines/<alias>/pty.sock` | Local end of the forwarded PTY-host socket |
| `<home>/.rove/machines/<alias>/cm` | The shared SSH connection (ControlMaster) |

Under a deeply-nested home these move to a short `$TMPDIR/rove-m-…` directory:
a unix socket path cannot exceed ~104 bytes, and `<home>/.rove/machines/…`
overruns that before it starts. The fallback is derived from the home and the
alias, so it is the same path every time.

The directory is owner-only (`0700`); so are the sockets in it. They reach a
daemon that runs commands as its owner.

## Not the same as `rove add --remote`

`rove add --remote` registers a remote *project* and drives git and the engine
over SSH from **your** daemon — it assumes the far side has no Rove. Machines
assume the far side runs Rove and speaks the daemon protocol. Both still exist;
they answer different questions.
