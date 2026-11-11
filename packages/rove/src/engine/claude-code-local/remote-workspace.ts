/**
 * Claude Code in a workspace on another machine. A PreToolUse hook rewrites each Bash command to run
 * there (`rove remote-workspace bash-hook`), so the Bash tool keeps its streaming, timeouts and
 * background runs; the local file tools are dropped for the workspace server's read / write / edit.
 * `=` forms throughout: these flags are variadic and would swallow the positional first message.
 */

import { resolveRoveSpawn } from "@sma1lboy/rove-daemon/client/daemon-process"
import { quoteShellArgv } from "../../lib/shell-command.ts"
import type { RemoteWorkspaceNote } from "../../machines/remote-workspace.ts"

/** The MCP server name: its tools are `mcp__workspace__read`, `__write` and `__edit`. */
const SERVER = "workspace"

const LOCAL_FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"]

export function claudeRemoteWorkspaceArgv(
  base: readonly string[],
  linkDir: string,
  /** How this install runs its own CLI: a hook must reach THIS build, not whichever `rove` is on PATH. */
  self: (subcommand: readonly string[]) => readonly string[] = resolveRoveSpawn,
): readonly string[] {
  const shim = (verb: string) => self(["remote-workspace", verb, "--dir", linkDir])
  const [command = "", ...args] = shim("mcp")
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: quoteShellArgv(shim("bash-hook")) }] }],
    },
  }
  return [
    ...base,
    `--settings=${JSON.stringify(settings)}`,
    `--mcp-config=${JSON.stringify({ mcpServers: { [SERVER]: { command, args } } })}`,
    `--disallowedTools=${LOCAL_FILE_TOOLS.join(",")}`,
  ]
}

export function claudeRemoteNotes(ws: RemoteWorkspaceNote): string {
  const where = `the machine "${ws.machine}"${ws.system ? ` (${ws.system})` : ""}`
  return [
    "# This project lives on another machine",
    "",
    `The project is not in this directory. It is on ${where}, at \`${ws.path}\`. This directory only links to it, and the environment details you were given describe this machine, not that one.`,
    "",
    "- Your Bash tool already runs every command there, in the project root. Use it as usual for git, tests, builds and searching (`rg`, `ls`, `find`).",
    "- Each Bash call starts in the project root; a `cd` does not carry over to the next call.",
    `- Read and change files with the \`mcp__${SERVER}__read\`, \`mcp__${SERVER}__write\` and \`mcp__${SERVER}__edit\` tools. Paths are relative to the project root. The local file tools are off: they would only see this directory.`,
    "",
  ].join("\n")
}
