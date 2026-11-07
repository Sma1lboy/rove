# Rove: the agent multiplexer for your terminal

<p align="center">
  <img src="docs/assets/brand/bracket-chip.gif" alt="Rove, the agent multiplexer for your terminal. Works with Claude Code, Codex, Copilot, and Kimi." />
</p>

Rove is a terminal-native workspace for running multiple coding tasks in parallel with [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex), [Copilot](https://github.com/github/copilot-cli), Kimi, Gemini CLI, OpenCode, Cursor Agent, [and more](./docs/ENGINES.md), or any CLI you register.

Rove isolates parallel work in git worktrees and branches, while agent and shell sessions keep running when you disconnect.

<p align="center">
  <a href="https://www.npmjs.com/package/@sma1lboy/rove"><img src="https://img.shields.io/npm/v/%40sma1lboy%2Frove?style=flat-square&label=npm&color=c96442" alt="npm version" /></a>
  <a href="https://github.com/Sma1lboy/rove/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Sma1lboy/rove/ci.yml?branch=main&style=flat-square" alt="build" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="https://docs.rove.run"><strong>Documentation</strong></a> ·
  <a href="https://docs.rove.run/rove/quick-start">Quick start</a> ·
  <a href="https://docs.rove.run/rove/concepts">Concepts</a> ·
  <a href="https://docs.rove.run/rove/cli">CLI</a> ·
  <a href="https://docs.rove.run/rove/api">Agent API</a> ·
  <a href="https://rove.run">Website</a>
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Rove demo: three repos, two engines, three agents running at once; the terminal closes, the agents keep working, and on reopening the Inbox lists their finished turns and one task's diff" />
</p>

The sidebar tracks tasks and their sessions. The workspace embeds the active agent or shell. The files pane shows what changed in the worktree. Switch tasks to read output, inspect a diff, run tests, or send the next instruction.

## How it fits together

```mermaid
flowchart LR
  subgraph phone["Phone"]
    app["iOS / Android app"]
    wxapp["WeChat"]
  end

  subgraph laptop["Your machine"]
    tui["TUI and rove api<br/>(you, scripts, agents)"]
    browser["Browser page"]
    bridge["rove-bridge<br/>(rove --web)"]
    core["Daemon<br/>tasks, issue store,<br/>PR poller, machine hub"]
    routines["Routines<br/>(cron, run by the daemon)"]
    pty["PTY Host<br/>engine CLIs in git worktrees<br/>Claude Code, Codex, ..."]
  end

  subgraph other["Another machine (over SSH)"]
    rhost["Its own daemon, routines,<br/>PTY Host and engine CLIs<br/>in git worktrees"]
  end

  github["GitHub"]
  cloud["Cloud (planned)<br/>hosted daemon and engines"]

  app -->|"Tailscale or<br/>Cloudflare tunnel"| bridge
  browser --> bridge
  tui --> core
  tui --> pty
  bridge --> core
  bridge --> pty
  wxapp -->|"iLink Bot API<br/>(daemon polls)"| core
  routines --> core
  core --> pty
  core -->|"gh"| github
  core -->|"SSH-forwarded sockets"| rhost
  core -.->|"planned"| cloud

  classDef client fill:#dbeafe,stroke:#2563eb,color:#111
  classDef engine fill:#ffedd5,stroke:#ea580c,color:#111
  classDef routine fill:#dcfce7,stroke:#16a34a,color:#111
  class app,wxapp,tui,browser client
  class pty,rhost engine
  class routines routine
  classDef planned fill:#fff,stroke:#6b7280,stroke-dasharray:5 5,color:#374151
  class cloud planned
```

- **Clients** (blue) hold no state. The TUI and `rove api` talk to the daemon and PTY Host over unix sockets; the browser page and phone apps go through `rove-bridge` ([Web](./docs/WEB.md), [iOS](./docs/IOS.md), [Android](./docs/ANDROID.md)); WeChat is [a bot the daemon polls](./docs/WEIXIN.md).
- **Daemon** owns tasks, worktrees, the issue store, PR status (via `gh`) and the machine hub. **Routines** fire from its scheduler, each opening an ordinary task ([Routines](./docs/ROUTINES.md)).
- **PTY Host** owns the engine CLIs (orange), each running in its task's git worktree. It outlives the TUI and the daemon ([Sessions](./docs/SESSIONS.md)).
- **Another machine** runs its own Rove; your daemon reaches it over SSH-forwarded sockets, so its tasks show up in your sidebar ([Machines](./docs/MACHINES.md)).
- **Cloud** (dashed) is planned, not shipped: [Roadmap](./docs/ROADMAP.md).
- Process ownership in detail: [Architecture](./docs/ARCHITECTURE.md).

## Quick start

Install Rove, then launch it in a repository. Rove runs on [Bun](https://bun.sh) ≥ 1.3.11, and the install script sets Bun up if you don't have it.

```bash
curl -fsSL https://rove.run/install.sh | sh
cd your-repo
rove
```

Press `n` to create your first task. You need git and at least one supported agent CLI on `PATH`; other install methods are under [Install](#install).

To let a coding agent drive Rove itself, install the skill:

```bash
rove skill install
```

## What you get

<p align="center">
  <img src="docs/assets/brand/promo-engines.png" alt="Every agent CLI, each in its own worktree. Built in: Claude Code, Codex, GitHub Copilot, Kimi Code, Pi, OMP. From the catalog, when the CLI is on your PATH: Gemini CLI, OpenCode, Cursor Agent, Grok CLI, Droid, Amp, Devin, Qoder CLI, Cline, Kiro CLI, Maki, Antigravity. Yours: any command you register, or an engine from a plugin." />
</p>

- **Parallel tasks, isolated in git.** Each task owns a worktree and branch, so a refactor, a bug fix, and a review move at the same time without agents overwriting each other's files.
- **Every agent CLI, side by side.** Each task picks its engine: Claude Code, Codex, Copilot, Kimi, Pi, OMP, Gemini CLI, OpenCode, Cursor Agent, [and more](./docs/ENGINES.md), or a CLI you register. Rove runs the real CLI, with its own auth, permissions, and models.
- **Sessions that outlive the terminal.** Quit the TUI or drop SSH, then reattach later. The agents keep working on the host.
- **Terminal-native.** No desktop app. Run Rove where the code lives: laptop, devbox, VPS, or a narrow mobile SSH session.
- **Scriptable.** Scripts and coding agents create, inspect, message, and land tasks through `rove api`.

## How it works

```text
Managed task
├── git worktree
├── git branch
└── terminal tabs
    ├── Claude Code
    ├── Codex
    └── shell
```

Tabs inside one task share its files, so work that needs isolation gets its own managed task; project-main tasks and `rove .` directory tasks deliberately reuse an existing directory. Sessions run on the host rather than in your terminal window, so they keep going when the TUI detaches and come back when you run `rove` again. The loop: start several tasks, switch between their live sessions, review each worktree's diff and checks, send follow-up instructions, then merge the branches that worked out. [Concepts](./docs/CONCEPTS.md) and [Sessions](./docs/SESSIONS.md) cover the full lifecycle.

## Install

The install script above sets up the Bun runtime Rove needs, then Rove itself. Or use the package manager you already have:

```bash
npm install -g @sma1lboy/rove   # offers to install Bun on first launch
bun install -g @sma1lboy/rove   # if you already run Bun
npx @sma1lboy/rove              # try it without installing
```

Rove runs on macOS, Linux, and Windows; Windows also requires Node.js and Git for Windows/Git Bash. The CLI runs on [Bun](https://bun.sh) ≥ 1.3.11, which every install route brings along. If your Bun lives somewhere unusual, point Rove at it with `ROVE_BUN=/path/to/bun`.

`rove` is the canonical command. The package also installs `rove` as a compatibility alias. On first launch, supported legacy state is copied into `~/.rove`; existing files and worktrees stay where they are.

## Scripting and Agent API

`rove api` exposes the same task model to shell scripts and coding agents. A run creates a task, checks its output, sends follow-ups, and lands the branch:

```bash
rove api add --repo "$PWD" --prompt "Fix the flaky auth test."
rove api list
rove api read-output --task-id <id>
rove api send --task-id <id> --prompt "Run the integration suite too."
rove api land --task-id <id>
```

The companion skill teaches a coding agent to drive that loop for you:

```bash
rove skill install
```

A task created from inside another Rove session remembers which task and tab dispatched it, so workers report results back without an external coordinator. The API also covers task inspection, notifications, prompts, panes, issue tracking, routines, and worktree-safe lifecycle operations.

Every verb, flag, and exit code is in the [Agent API reference](https://docs.rove.run/rove/api).

## Plugins

<p align="center">
  <img src="docs/assets/brand/promo-plugins.jpg" alt="Make it yours: rove plugin search lists the first-party plugins notify, github-start, worktree-include, linear-start, lazygit, and browser, beside a mod's Counter pane that the TUI and the web both draw." />
</p>

A plugin is a directory with a `rove-plugin.toml` manifest and commands in any language. It can add panes, react to events such as a finished agent turn, register commands and settings, and contribute whole engines. Browse and install from the terminal:

```bash
rove plugin search
rove plugin install owner/repo
```

The same catalog is on [rove.run/plugins](https://rove.run/plugins) and under Settings → Marketplace. Any public GitHub repo tagged `rove-plugin` shows up there; [plugin authoring](./docs/PLUGIN-AUTHORING.md) covers the manifest, the event catalog, and the optional TypeScript SDK.

A plugin can also ship a **mod**: one long-running process that draws panes of text, buttons, and input fields. The TUI and the browser client (`rove --web`) draw the same pane from the same data, so a button pressed in either one updates both. Mods appear on the rail's Mods page; see [Mods](./docs/PLUGIN-AUTHORING.md#mods) and the [`counter-mod` example](./packages/rove-plugin-sdk/examples/counter-mod).

## More features

- **Review.** Diff views, plus inline notes that go back as one agent prompt.
- **Recovery.** Rate-limit resume, cross-engine handoff, several agents inside one task.
- **Remote ergonomics.** Narrow and mobile layouts, a durable Inbox, notifications, attachments.
- **Unattended work.** Scheduled routines, with optional prechecks that skip idle runs.
- **Planning context.** Local Kanban, GitHub issue intake, reusable repository field notes.
- **Customization.** Themes, and [plugins](#plugins) with custom panes, events, commands, engines, and mods.

Details live in the [TUI guide](./docs/TUI.md), [Routines](./docs/ROUTINES.md), [configuration](./docs/CONFIGURATION.md), and [plugin authoring](./docs/PLUGIN-AUTHORING.md).

## Troubleshooting

```bash
rove doctor
```

[Troubleshooting](./docs/TROUBLESHOOTING.md) has the diagnostics and recovery steps.

## Development

```bash
bun install
bun run dev:sandbox
bun run test
```

Start with [CONTRIBUTING.md](./CONTRIBUTING.md) and [Architecture](./docs/ARCHITECTURE.md). Shipped behavior is in the [changelog](./packages/rove/CHANGELOG.md).

## License

[MIT](./LICENSE) © Jackson Chen

## Star History

<a href="https://star-history.com/#sma1lboy/rove&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=sma1lboy/rove&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=sma1lboy/rove&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=sma1lboy/rove&type=Date" />
  </picture>
</a>
