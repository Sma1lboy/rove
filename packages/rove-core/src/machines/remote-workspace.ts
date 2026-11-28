/**
 * A workspace on another machine, worked in by an agent that runs HERE: the task's files and every
 * command live in a worktree on that machine (a `--worktree-only` task of its Rove), and this machine
 * holds only a link directory, the engine's cwd. The link carries `rx`, which runs one command in the
 * worktree over the machine's shared ssh connection, and the instruction files an engine reads from
 * its cwd. That machine needs Rove and git, never an engine or its login.
 */

import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { pathWithin } from "@sma1lboy/rove-daemon/path-identity"
import { REMOTE_WORKSPACE_FILE } from "@sma1lboy/rove-daemon/repo-id"
import { homeDir } from "../env.ts"
import { runAsync } from "../lib/run-async.ts"
import { quoteShellArg, quoteShellArgv } from "../lib/shell-command.ts"
import {
  SSH_SHELL_IS_CMD,
  SSH_SHELL_PROBE,
  isWindowsPath,
  windowsRshScript,
  windowsRxScript,
} from "./windows-remote.ts"

export { REMOTE_WORKSPACE_FILE }

export interface RemoteWorkspace {
  /** The registered machine's alias. */
  readonly machine: string
  /** The `--worktree-only` task on that machine that owns the worktree. */
  readonly taskId: string
  /** The worktree's path there. */
  readonly path: string
  readonly branch?: string
  /** The repo across machines, as that machine named it: what groups the task under its project here. */
  readonly repoId?: string
}

/** What an instruction file is written from. */
export interface RemoteWorkspaceNote extends RemoteWorkspace {
  /** `uname -sm` there; "" when it did not say. */
  readonly system: string
  /** That machine's MCP servers forwarded into the session (`remote-mcp.ts`), by their session name. */
  readonly mcp?: readonly string[]
}

/** An engine's own instruction file for a link directory (the registry's `remoteWorkspace.notes`). */
export interface RemoteNotesFile {
  readonly file: string
  readonly text: (ws: RemoteWorkspaceNote) => string
}

/** Every link directory lives under here, so removing one can never reach a directory Rove did not make. */
export function remoteWorkspacesRoot(home = homeDir()): string {
  return join(home, ".rove", "remote-workspaces")
}

/** A path there as that machine compares it: Windows paths without case or slash style. */
export function remotePathKey(path: string): string {
  return (isWindowsPath(path) ? path.replaceAll("\\", "/").toLowerCase() : path).replace(/(?<=.)\/+$/, "")
}

/**
 * The link directory: one per machine and path there, so every session on that path shares a cwd and an
 * engine that keys its history by cwd lists them all. It ends in `<machine>/<repo folder>`: a sidebar
 * names a directory by its folder, and by its last two segments when another project shares that folder name.
 */
export function remoteWorkspaceDir(machine: string, path: string, name: string, home = homeDir()): string {
  const id = createHash("sha256")
    .update(`${machine}\0${remotePathKey(path)}`)
    .digest("hex")
    .slice(0, 12)
  return join(remoteWorkspacesRoot(home), id, machine, basename(name.replaceAll("\\", "/")) || "workspace")
}

export function readRemoteWorkspace(dir: string): RemoteWorkspace | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, REMOTE_WORKSPACE_FILE), "utf8")) as Partial<RemoteWorkspace>
    if (typeof raw.machine !== "string" || typeof raw.taskId !== "string" || typeof raw.path !== "string") return null
    return {
      machine: raw.machine,
      taskId: raw.taskId,
      path: raw.path,
      ...(typeof raw.branch === "string" ? { branch: raw.branch } : {}),
      ...(typeof raw.repoId === "string" ? { repoId: raw.repoId } : {}),
    }
  } catch {
    return null
  }
}

export const isRemoteWorkspace = (dir: string): boolean => existsSync(join(dir, REMOTE_WORKSPACE_FILE))

/** `<dir>/bin`, put first on a session's PATH so `rx` resolves. */
export const remoteBinDir = (dir: string): string => join(dir, "bin")

export const rxPath = (dir: string): string => join(remoteBinDir(dir), "rx")

/** In a generated sh script: makes a value safe inside the single quotes of the command line sent over ssh. */
const SED_QUOTE = `sed "s/'/'\\\\\\\\''/g"`

/**
 * `rx '<command>'`: the command runs in the worktree through that machine's login shell (its PATH), with
 * stdin, output and the exit code passed through.
 * ponytail: a PATH set only in an interactive rc is not seen. A Windows machine has its own (`windowsRxScript`).
 */
export function rxScript(sshArgv: readonly string[], path: string): string {
  return [
    "#!/bin/sh",
    "# Rove: run one command in this task's workspace on another machine.",
    `dir=${quoteShellArg(path)}`,
    `d=$(printf '%s' "$dir" | ${SED_QUOTE})`,
    `c=$(printf '%s' "$1" | ${SED_QUOTE})`,
    `exec ${quoteShellArgv(sshArgv)} "cd '$d' && exec \\"\\\${SHELL:-sh}\\" -lc '$c'"`,
    "",
  ].join("\n")
}

/** `rsh`: an interactive login shell in the worktree, for a shell tab. */
export function rshScript(sshArgv: readonly string[], path: string): string {
  const [ssh = "ssh", ...rest] = sshArgv
  return [
    "#!/bin/sh",
    "# Rove: open a shell in this task's workspace on another machine.",
    `dir=${quoteShellArg(path)}`,
    `d=$(printf '%s' "$dir" | ${SED_QUOTE})`,
    `exec ${quoteShellArgv([ssh, "-t", ...rest])} "cd '$d' && exec \\"\\\${SHELL:-sh}\\" -l"`,
    "",
  ].join("\n")
}

export const rshPath = (dir: string): string => join(remoteBinDir(dir), "rsh")

/** Typed into a fresh shell tab of a link directory: the tab becomes a shell in the worktree. "" elsewhere. */
export function remoteShellInput(dir: string): string {
  return existsSync(rshPath(dir)) ? ` exec ${quoteShellArg(rshPath(dir))}\r` : ""
}

/** The worktree task a link directory stands for, as the file readers address a task on another machine. */
export function linkedWorktree(dir: string | undefined): { machine: string; taskId: string } | undefined {
  const ws = dir ? readRemoteWorkspace(dir) : null
  return ws ? { machine: ws.machine, taskId: ws.taskId } : undefined
}

/** AGENTS.md: the way every engine can work there, with no wiring of its own. */
export function remoteNotes(ws: RemoteWorkspaceNote): string {
  const where = `the machine "${ws.machine}"${ws.system ? ` (${ws.system})` : ""}`
  return [
    "# This project lives on another machine",
    "",
    `The project is not in this directory. It is on ${where}, at \`${ws.path}\`. This directory only links to it.`,
    "",
    "- Run every command as `rx '<command>'`. It runs in the project root there and passes stdin, output and the exit code through: `rx 'git status'`, `rx 'cat > src/a.ts' <<'EOF'`.",
    "- Each `rx` call starts in the project root; a `cd` does not carry over to the next call.",
    "- Read, search and edit the project's files through commands there. File tools that work on local paths only see this directory.",
    "- git, tests and builds all run there. Nothing of the project is on this machine.",
    ...whereThingsRun(
      ws,
      "- Run `rove` without `rx`: Rove and your task are on this machine, so `rove api …` reaches this Rove and takes this machine's paths.",
    ),
    "",
  ].join("\n")
}

/** What runs on which machine beyond the project's commands and files; `roveLine` is how that engine runs `rove` here. */
export function whereThingsRun(ws: RemoteWorkspaceNote, roveLine: string): string[] {
  const forwarded = ws.mcp ?? []
  return [
    "",
    "## Which machine runs what",
    "",
    roveLine,
    `- Your MCP tools${forwarded.length > 0 ? " not listed below" : ""}, a browser among them, run on this machine, so \`localhost\` in them is this machine, not the project's.`,
    forwarded.length > 0
      ? `- These MCP servers are ${ws.machine}'s, forwarded here: ${forwarded.map((s) => `\`${s}\``).join(", ")}. A page served on ${ws.machine} (a dev server you started there) opens in its browser at ${ws.machine}'s own \`localhost\` address; use them for that.`
      : `- A page served on ${ws.machine} is not at this machine's \`localhost\`. To open it in ${ws.machine}'s own browser, the owner can forward that machine's browser MCP server: \`rove machine mcp ${ws.machine} <name> <url>\`; it shows up in new sessions as \`<name>-${ws.machine}\`.`,
    `- Earlier sessions in this project that ran from this directory can be resumed here. Sessions that ran natively on ${ws.machine} (the agent there) are stored on ${ws.machine} and cannot be resumed here; to continue one, use \`rove api add --machine ${ws.machine} --engine-there\` or start the session on ${ws.machine}.`,
  ]
}

/** The project's own instructions there, so they load as they would from its checkout. */
function projectInstructions(text: string): string {
  return text.trim() ? `\n# The project's own instructions\n\n${text.trim()}\n` : ""
}

export interface LinkInput {
  readonly ws: RemoteWorkspace
  /** `machineSshArgs` for the machine. */
  readonly sshArgv: readonly string[]
  /** Each wired engine's instruction file. */
  readonly engineNotes: readonly RemoteNotesFile[]
  /** The repo's folder on that machine: the link directory is named after it. */
  readonly repo: string
  /** Session names of that machine's forwarded MCP servers, for the notes. */
  readonly mcp?: readonly string[]
}

/** Splits the probe's output: the system line, then the project's instructions. */
const MARK = "@@rove-workspace@@"

/** Replaced whole, never truncated in place: another session may be running from the same link directory. */
function writeAtomic(file: string, text: string, mode?: number): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  if (mode !== undefined) chmodSync(tmp, mode)
  renameSync(tmp, file)
}

/**
 * Make (or refresh) the link directory and probe the worktree through it. Throws when that machine does
 * not answer, removing the directory only when this call made it.
 */
export async function createRemoteLink(input: LinkInput, home = homeDir()): Promise<string> {
  const { ws } = input
  const dir = remoteWorkspaceDir(ws.machine, ws.path, input.repo, home)
  const created = !isRemoteWorkspace(dir)
  mkdirSync(remoteBinDir(dir), { recursive: true })
  writeAtomic(join(dir, REMOTE_WORKSPACE_FILE), `${JSON.stringify(ws, null, 2)}\n`)
  if (isWindowsPath(ws.path)) {
    const shell = await runAsync(input.sshArgv[0] ?? "ssh", [...input.sshArgv.slice(1), SSH_SHELL_PROBE], {
      timeoutMs: 30_000,
    })
    writeAtomic(rxPath(dir), windowsRxScript(input.sshArgv, ws.path, SSH_SHELL_IS_CMD.test(shell.stdout)), 0o755)
    writeAtomic(rshPath(dir), windowsRshScript(input.sshArgv, ws.path), 0o755)
  } else {
    writeAtomic(rxPath(dir), rxScript(input.sshArgv, ws.path), 0o755)
    writeAtomic(rshPath(dir), rshScript(input.sshArgv, ws.path), 0o755)
  }
  const probe = await runAsync(
    rxPath(dir),
    [`uname -sm; echo ${MARK}; cat AGENTS.md 2>/dev/null || cat CLAUDE.md 2>/dev/null`],
    { timeoutMs: 30_000 },
  )
  if (!probe.ok && !probe.stdout.includes(MARK)) {
    if (created) removeRemoteLink(dir, home)
    throw new Error(`${ws.machine} did not answer at ${ws.path}: ${(probe.stderr || "ssh failed").trim()}`)
  }
  const [system = "", ...rest] = probe.stdout.split(`\n${MARK}\n`)
  const note: RemoteWorkspaceNote = { ...ws, system: system.trim(), ...(input.mcp?.length ? { mcp: input.mcp } : {}) }
  const project = projectInstructions(rest.join(`\n${MARK}\n`))
  writeAtomic(join(dir, "AGENTS.md"), remoteNotes(note) + project)
  for (const notes of input.engineNotes) writeAtomic(join(dir, notes.file), notes.text(note) + project)
  return dir
}

/** Remove a link directory; anything outside the links root is left alone. */
export function removeRemoteLink(dir: string, home = homeDir()): void {
  if (!pathWithin(remoteWorkspacesRoot(home), dir) || !isRemoteWorkspace(dir)) return
  rmSync(dir, { recursive: true, force: true })
  // The directories that held it; each left alone when anything else is in it.
  for (const parent of [dirname(dir), dirname(dirname(dir))]) {
    try {
      rmdirSync(parent)
    } catch {}
  }
}
