import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { bashHookReply, callWorkspaceTool, mcpReply } from "../../src/cli/remote-workspace-cmd.ts"
import { claudeRemoteWorkspaceArgv } from "../../src/engine/claude-code-local/remote-workspace.ts"
import { buildEngineSessionLaunch } from "../../src/engine/session-launch.ts"
import {
  REMOTE_WORKSPACE_FILE,
  createRemoteLink,
  readRemoteWorkspace,
  remoteWorkspaceDir,
  removeRemoteLink,
  rxScript,
} from "../../src/machines/remote-workspace.ts"

/** `sh -c` stands in for ssh: the "remote" command line runs in a local shell, so the quoting is the real one. */
const LOCAL_SSH = ["sh", "-c"]

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "rove-rw-"))
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

  test("the link directory names the worktree, carries both instruction files with the project's own, and is all a removal takes", () => {
    const home = scratch()
    const worktree = scratch()
    writeFileSync(join(worktree, "AGENTS.md"), "Use tabs.\n")
    const ws = { machine: "deck", taskId: "T1", path: worktree, branch: "rove/x" }
    const dir = createRemoteLink(
      { ws, sshArgv: LOCAL_SSH, engineNotes: [{ file: "CLAUDE.md", text: (w) => `wired on ${w.machine}\n` }] },
      home,
    )
    expect(dir).toBe(remoteWorkspaceDir("deck", "T1", home))
    expect(readRemoteWorkspace(dir)).toEqual(ws)
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toMatch(/rx '<command>'[\s\S]*Use tabs\./)
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toMatch(/^wired on deck\n[\s\S]*Use tabs\./)

    // A directory that is not a link, or sits outside the links root, is never removed.
    removeRemoteLink(worktree, home)
    expect(existsSync(worktree)).toBe(true)
    removeRemoteLink(dir, home)
    expect(existsSync(dir)).toBe(false)
  })

  test("a machine that does not answer leaves no link behind", () => {
    const home = scratch()
    const ws = { machine: "gone", taskId: "T2", path: "/nowhere" }
    expect(() => createRemoteLink({ ws, sshArgv: ["false"], engineNotes: [] }, home)).toThrow(/gone did not answer/)
    expect(existsSync(join(remoteWorkspaceDir("gone", "T2", home), REMOTE_WORKSPACE_FILE))).toBe(false)
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

  test("the file tools read a range, write through stdin, and edit only an unambiguous match", () => {
    const files = new Map([["a.ts", "one\ntwo\none\n"]])
    const run = (command: string, stdin?: string) => {
      const name = /'([^']+)'$/.exec(command)?.[1] ?? ""
      if (command.includes("cat >")) files.set(name, stdin ?? "")
      else if (!files.has(name)) return { ok: false, out: `${name}: No such file` }
      return { ok: true, out: files.get(name) ?? "" }
    }
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
    expect(argv[3]).toBe("--disallowedTools=Read,Edit,Write,Glob,Grep,NotebookEdit")
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
    expect(claude.indexOf("--disallowedTools=")).toBeGreaterThan(0)
    expect(claude.indexOf("--disallowedTools=")).toBeLessThan(claude.indexOf("ship it"))
    const codex = launch("codex", true)
    expect(codex).toContain(`PATH='/links/t/bin':"$PATH"`)
    expect(codex).not.toContain("--mcp-config")
    expect(launch("claude", false)).not.toMatch(/links\/t\/bin|--mcp-config/)
  })
})
