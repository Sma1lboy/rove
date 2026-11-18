import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeRepoId } from "@sma1lboy/rove-daemon/repo-id"
import { describe, expect, test } from "vitest"
import { bashHookReply, callWorkspaceTool, fileHookReply, mcpReply } from "../../src/cli/remote-workspace-cmd.ts"
import { claudeRemoteWorkspaceArgv } from "../../src/engine/claude-code-local/remote-workspace.ts"
import { buildEngineSessionLaunch } from "../../src/engine/session-launch.ts"
import { addStaysHere } from "../../src/machines/forward.ts"
import type { MachineEntry } from "../../src/machines/registry.ts"
import {
  REMOTE_WORKSPACE_FILE,
  createRemoteLink,
  linkedWorktree,
  readRemoteWorkspace,
  remoteShellInput,
  remoteWorkspaceDir,
  removeRemoteLink,
  rxScript,
} from "../../src/machines/remote-workspace.ts"

/** `sh -c` stands in for ssh: the "remote" command line runs in a local shell, so the quoting is the real one. */
const LOCAL_SSH = ["sh", "-c"]

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "rove-rw-"))
}

/** A remote shell over an in-memory file map: `cat > 'name'` writes stdin, anything else reads `name`. */
function fakeRemoteFiles(files: Map<string, string>) {
  return (command: string, stdin?: string) => {
    const name = /'([^']+)'$/.exec(command)?.[1] ?? ""
    if (command.includes("cat >")) files.set(name, stdin ?? "")
    else if (!files.has(name)) return { ok: false, out: `${name}: No such file` }
    return { ok: true, out: files.get(name) ?? "" }
  }
}

describe("a workspace on another machine", () => {
  test("rx runs the command in the worktree and passes quotes, stdin and the exit code through", () => {
    const worktree = join(scratch(), "it's here")
    mkdirSync(worktree)
    const rx = join(scratch(), "rx")
    writeFileSync(rx, rxScript(LOCAL_SSH, worktree))
    chmodSync(rx, 0o755)
    const run = (command: string, input?: string) => spawnSync(rx, [command], { input, encoding: "utf8" })

    expect(run("pwd").stdout.trim().endsWith("it's here")).toBe(true)
    expect(run(`printf '%s|' "a b" 'c"d' "it's"`).stdout).toBe(`a b|c"d|it's|`)
    run("cat > note.txt", "from stdin\n")
    expect(readFileSync(join(worktree, "note.txt"), "utf8")).toBe("from stdin\n")
    expect(run("exit 7").status).toBe(7)
  })

  test("the link directory names the worktree, carries both instruction files with the project's own, and is all a removal takes", async () => {
    const home = scratch()
    const worktree = scratch()
    writeFileSync(join(worktree, "AGENTS.md"), "Use tabs.\n")
    const ws = { machine: "deck", taskId: "T1", path: worktree, branch: "rove/x" }
    const dir = await createRemoteLink(
      {
        ws,
        repo: "/srv/code/app",
        sshArgv: LOCAL_SSH,
        engineNotes: [{ file: "CLAUDE.md", text: (w) => `wired on ${w.machine}\n` }],
      },
      home,
    )
    expect(dir).toBe(join(home, ".rove", "remote-workspaces", "deck", "T1", "app"))
    expect(readRemoteWorkspace(dir)).toEqual(ws)
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toMatch(/rx '<command>'[\s\S]*Use tabs\./)
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toMatch(/^wired on deck\n[\s\S]*Use tabs\./)

    // The file readers address the worktree's task there; a fresh shell tab is told to open there.
    expect(linkedWorktree(dir)).toEqual({ machine: "deck", taskId: "T1" })
    expect(linkedWorktree(worktree)).toBeUndefined()
    expect(remoteShellInput(dir)).toBe(` exec '${join(dir, "bin", "rsh")}'\r`)
    expect(remoteShellInput(worktree)).toBe("")

    // A directory that is not a link, or sits outside the links root, is never removed.
    removeRemoteLink(worktree, home)
    expect(existsSync(worktree)).toBe(true)
    removeRemoteLink(dir, home)
    expect(existsSync(join(home, ".rove", "remote-workspaces", "deck", "T1"))).toBe(false)
  })

  test("a machine that does not answer leaves no link behind", async () => {
    const home = scratch()
    const ws = { machine: "gone", taskId: "T2", path: "/nowhere" }
    await expect(createRemoteLink({ ws, repo: "/x", sshArgv: ["false"], engineNotes: [] }, home)).rejects.toThrow(
      /gone did not answer/,
    )
    expect(existsSync(join(remoteWorkspaceDir("gone", "T2", "/x", home), REMOTE_WORKSPACE_FILE))).toBe(false)
  })

  test("the shell hook sends a command through rx once, keeps the call's other fields, and decides no permission", () => {
    const reply = JSON.parse(
      bashHookReply(JSON.stringify({ tool_input: { command: "bun test 'a b'", timeout: 5000 } }), "/l/bin/rx"),
    )
    expect(reply.hookSpecificOutput.updatedInput).toEqual({
      command: `'/l/bin/rx' 'bun test '\\''a b'\\'''`,
      timeout: 5000,
    })
    expect(reply.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(bashHookReply(JSON.stringify({ tool_input: { command: "rx 'ls'" } }), "/l/bin/rx")).toBe("")
    expect(bashHookReply("not json", "/l/bin/rx")).toBe("")
  })

  test("a local file tool keeps this machine's files and is turned back from the project's", () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-file-hook-"))
    writeFileSync(join(dir, REMOTE_WORKSPACE_FILE), JSON.stringify({ machine: "deck", taskId: "T3", path: "/srv/app" }))
    const reply = (input: object) => fileHookReply(JSON.stringify({ cwd: dir, tool_input: input }), dir)
    expect(reply({ file_path: "/Users/me/notes.md" })).toBe("")
    const denied = {
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining('the machine "deck"'),
    }
    expect(
      [{ file_path: "src/a.ts" }, { pattern: "TODO" }, { file_path: "/srv/app/src/a.ts" }].map(
        (input) => JSON.parse(reply(input)).hookSpecificOutput,
      ),
    ).toEqual([expect.objectContaining(denied), expect.objectContaining(denied), expect.objectContaining(denied)])
  })

  test("the file tools read a range, write through stdin, and edit only an unambiguous match", () => {
    const files = new Map([["a.ts", "one\ntwo\none\n"]])
    const run = fakeRemoteFiles(files)
    expect(callWorkspaceTool(run, "read", { path: "a.ts" })).toBe("one\ntwo\none\n")
    expect(() => callWorkspaceTool(run, "read", { path: "missing.ts" })).toThrow(/No such file/)
    expect(() => callWorkspaceTool(run, "edit", { path: "a.ts", old_string: "one", new_string: "1" })).toThrow(
      /occurs 2 times/,
    )
    expect(() => callWorkspaceTool(run, "edit", { path: "a.ts", old_string: "nine", new_string: "9" })).toThrow(
      /not found/,
    )
    callWorkspaceTool(run, "edit", { path: "a.ts", old_string: "two", new_string: "2" })
    expect(files.get("a.ts")).toBe("one\n2\none\n")
    callWorkspaceTool(run, "write", { path: "b.ts", content: "new\n" })
    expect(files.get("b.ts")).toBe("new\n")
  })

  test("the MCP server lists its tools, reports a failed call as a tool error, and ignores notifications", () => {
    const run = () => ({ ok: false, out: "ssh: connection refused" })
    const listed = mcpReply(run, { id: 1, method: "tools/list" }) as { result: { tools: { name: string }[] } }
    expect(listed.result.tools.map((t) => t.name)).toEqual(["read", "write", "edit"])
    const failed = mcpReply(run, { id: 2, method: "tools/call", params: { name: "read", arguments: { path: "a" } } })
    expect(failed).toMatchObject({ id: 2, result: { isError: true, content: [{ text: "ssh: connection refused" }] } })
    expect(mcpReply(run, { method: "notifications/initialized" })).toBeNull()
  })

  test("claude is wired with flags that cannot swallow the first message, pointing at this install's CLI", () => {
    const argv = claudeRemoteWorkspaceArgv(["claude"], "/links/my task", (sub) => ["/bin/rove dev", ...sub])
    expect(argv.every((arg, i) => i === 0 || (arg.startsWith("--") && arg.includes("=")))).toBe(true)
    const settings = JSON.parse(argv[1]?.slice("--settings=".length) ?? "")
    expect(settings.hooks.PreToolUse[0]).toEqual({
      matcher: "Bash",
      hooks: [{ type: "command", command: "'/bin/rove dev' 'remote-workspace' 'bash-hook' '--dir' '/links/my task'" }],
    })
    expect(settings.hooks.PreToolUse[1].matcher).toBe("Read|Edit|Write|Glob|Grep|NotebookEdit")
    expect(argv.join(" ")).not.toContain("--disallowedTools")
  })

  test("a session in a link directory gets rx on its PATH; a wired engine also gets its flags, ahead of the prompt", () => {
    const launch = (vendor: "claude" | "codex", remote: boolean) =>
      buildEngineSessionLaunch({
        task: { id: "task-1", kind: "dir", vendor, repo: "/links/t" },
        worktreePath: "/links/t",
        shell: "/bin/zsh",
        argv: [vendor],
        promptIntent: { kind: "explicit", prompt: "ship it" },
        protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
        isRemoteWorkspace: () => remote,
      }).command[2] ?? ""

    const claude = launch("claude", true)
    expect(claude).toContain(`PATH='/links/t/bin':"$PATH"`)
    expect(claude.indexOf("--mcp-config=")).toBeGreaterThan(0)
    expect(claude.indexOf("--mcp-config=")).toBeLessThan(claude.indexOf("ship it"))
    const codex = launch("codex", true)
    expect(codex).toContain(`PATH='/links/t/bin':"$PATH"`)
    expect(codex).not.toContain("--mcp-config")
    expect(launch("claude", false)).not.toMatch(/links\/t\/bin|--mcp-config/)
  })

  test("add --machine keeps the agent here unless the engine is asked for there or only that machine can serve the request", () => {
    const deck: MachineEntry = { alias: "deck", host: "deck", auth: { kind: "key" } }
    const windows = { ...deck, alias: "pc", roveBin: "C:\\rove\\rove.exe" }
    expect(addStaysHere("add", { repo: "me/app", prompt: "p" }, deck)).toBe(true)
    expect(addStaysHere("add", { repo: "me/app", prompt: "p", "engine-there": true }, deck)).toBe(false)
    expect(addStaysHere("add", { repo: "me/app", prompt: "p", count: "3" }, deck)).toBe(false)
    expect(addStaysHere("add", { repo: "me/app", "worktree-only": true }, deck)).toBe(false)
    expect(addStaysHere("add", { repo: ["me/app", "me/lib"], prompt: "p" }, deck)).toBe(false)
    expect(addStaysHere("add", { repo: "me/app", prompt: "p" }, windows)).toBe(false)
    expect(addStaysHere("send", { "task-id": "T" }, deck)).toBe(false)
  })

  test("a link directory answers with its worktree's repo id, so the task groups under its project", () => {
    const dir = scratch()
    writeFileSync(
      join(dir, REMOTE_WORKSPACE_FILE),
      JSON.stringify({ machine: "deck", taskId: "T", path: "/w", repoId: "github.com/me/app" }),
    )
    expect(computeRepoId(dir)).toBe("github.com/me/app")
    expect(computeRepoId(scratch())).toBeUndefined()
  })
})
