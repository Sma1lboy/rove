/**
 * A workspace on another machine, worked in by an agent that runs HERE: the task's files and every
 * command live in a worktree on that machine (a `--worktree-only` task of its Rove), and this machine
 * holds only a link directory, the engine's cwd. The link carries `rx`, which runs one command in the
 * worktree over the machine's shared ssh connection, and the instruction files an engine reads from
 * its cwd. That machine needs Rove and git, never an engine or its login.
 */

import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathWithin } from "@sma1lboy/rove-daemon/path-identity"
import { homeDir } from "../env.ts"
import { quoteShellArg, quoteShellArgv } from "../lib/shell-command.ts"

/** In a link directory: which machine's worktree it stands for. */
export const REMOTE_WORKSPACE_FILE = ".rove-remote.json"

export interface RemoteWorkspace {
  /** The registered machine's alias. */
  readonly machine: string
  /** The `--worktree-only` task on that machine that owns the worktree. */
  readonly taskId: string
  /** The worktree's path there. */
  readonly path: string
  readonly branch?: string
}

/** What an instruction file is written from. */
export interface RemoteWorkspaceNote extends RemoteWorkspace {
  /** `uname -sm` there; "" when it did not say. */
  readonly system: string
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

export function remoteWorkspaceDir(machine: string, taskId: string, home = homeDir()): string {
  return join(remoteWorkspacesRoot(home), machine, taskId)
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
    }
  } catch {
    return null
  }
}

export const isRemoteWorkspace = (dir: string): boolean => existsSync(join(dir, REMOTE_WORKSPACE_FILE))

/** `<dir>/bin`, put first on a session's PATH so `rx` resolves. */
export const remoteBinDir = (dir: string): string => join(dir, "bin")

export const rxPath = (dir: string): string => join(remoteBinDir(dir), "rx")

/**
 * `rx '<command>'`: the command runs in the worktree through that machine's login shell (its PATH), with
 * stdin, output and the exit code passed through.
 * ponytail: POSIX machines only, and a PATH set only in an interactive rc is not seen; a Windows machine
 * needs its own transport.
 */
export function rxScript(sshArgv: readonly string[], path: string): string {
  const quoted = `sed "s/'/'\\\\\\\\''/g"`
  return [
    "#!/bin/sh",
    "# Rove: run one command in this task's workspace on another machine.",
    `dir=${quoteShellArg(path)}`,
    `d=$(printf '%s' "$dir" | ${quoted})`,
    `c=$(printf '%s' "$1" | ${quoted})`,
    `exec ${quoteShellArgv(sshArgv)} "cd '$d' && exec \\"\\\${SHELL:-sh}\\" -lc '$c'"`,
    "",
  ].join("\n")
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
    "",
  ].join("\n")
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
}

/** Splits the probe's output: the system line, then the project's instructions. */
const MARK = "@@rove-workspace@@"

/** Make the link directory and probe the worktree through it. Throws when that machine does not answer. */
export function createRemoteLink(input: LinkInput, home = homeDir()): string {
  const { ws } = input
  const dir = remoteWorkspaceDir(ws.machine, ws.taskId, home)
  mkdirSync(remoteBinDir(dir), { recursive: true })
  writeFileSync(join(dir, REMOTE_WORKSPACE_FILE), `${JSON.stringify(ws, null, 2)}\n`)
  writeFileSync(rxPath(dir), rxScript(input.sshArgv, ws.path))
  chmodSync(rxPath(dir), 0o755)
  const probe = spawnSync(
    rxPath(dir),
    [`uname -sm; echo ${MARK}; cat AGENTS.md 2>/dev/null || cat CLAUDE.md 2>/dev/null`],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  )
  if (probe.status !== 0 && !probe.stdout.includes(MARK)) {
    removeRemoteLink(dir, home)
    throw new Error(`${ws.machine} did not answer at ${ws.path}: ${(probe.stderr || "ssh failed").trim()}`)
  }
  const [system = "", ...rest] = probe.stdout.split(`\n${MARK}\n`)
  const note: RemoteWorkspaceNote = { ...ws, system: system.trim() }
  const project = projectInstructions(rest.join(`\n${MARK}\n`))
  writeFileSync(join(dir, "AGENTS.md"), remoteNotes(note) + project)
  for (const notes of input.engineNotes) writeFileSync(join(dir, notes.file), notes.text(note) + project)
  return dir
}

/** Remove a link directory; anything outside the links root is left alone. */
export function removeRemoteLink(dir: string, home = homeDir()): void {
  if (!pathWithin(remoteWorkspacesRoot(home), dir) || !isRemoteWorkspace(dir)) return
  rmSync(dir, { recursive: true, force: true })
}
