import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  buildEngineSessionLaunch,
  engineLaunchLine,
  engineSessionKey,
  initMarkerSaysFinished,
} from "../../src/engine/session-launch.ts"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeWorktree(files: Record<string, string>): string {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-session-launch-"))
  tempDirs.push(worktree)
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(worktree, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return worktree
}

describe("hosted engine session launch", () => {
  test("uses the first engine tab as the canonical task session key", () => {
    expect(engineSessionKey("task-1")).toBe("task-1::tab-1")
  })

  test("builds an interactive shell launch with the explicit first prompt", () => {
    const launch = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "claude", repo: "/repo" },
      worktreePath: "/repo/.worktrees/task-1",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "explicit", prompt: "fix it" },
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
    })

    expect(launch.key).toBe("task-1::tab-1")
    expect(launch.command.slice(0, 2)).toEqual(["/bin/zsh", "-ilc"])
    expect(launch.command[2]).toContain("claude 'fix it'")
    expect(launch.command[2]).toContain("ROVE_TASK_ID='task-1' KOBE_TASK_ID='task-1'")
    expect(launch.command[2]).toContain("ROVE_TAB_ID='tab-1' KOBE_TAB_ID='tab-1'")
    expect(launch.command[2]).toContain('exec "${SHELL:-/bin/sh}"')
  })

  test("new-task intent puts the user's prompt on the argv, with nothing appended", () => {
    // Standing worker instructions (name your branch, report home) moved to
    // the Rove agent skill; the first prompt is now the user's text plus only
    // facts about THIS worktree, which no skill can know.
    const launch = buildEngineSessionLaunch({
      task: { id: "task-9", kind: "task", vendor: "claude", repo: "/repo" },
      worktreePath: "/repo/.worktrees/task-9",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "new-task", prompt: "fix it" },
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
    })
    expect(launch.command[2]).toContain("claude 'fix it'")
    expect(launch.command[2]).not.toContain("set-branch")
  })

  test("keeps a paste vendor's first message OUT of the argv and hands it to the spawner", () => {
    const launch = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "kimi", repo: "/repo" },
      worktreePath: "/repo/.worktrees/task-1",
      shell: "/bin/zsh",
      argv: ["kimi", "-y"],
      promptIntent: { kind: "explicit", prompt: "fix it" },
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
    })

    // kimi's positional CLI slot is a subcommand — a prompt there exits the
    // engine with "Unknown command". The spawner pastes it post-spawn.
    expect(launch.command[2]).not.toContain("fix it")
    expect(launch.firstMessage).toBe("fix it")
  })

  test("an explicit argv override keeps the prompt on the launch line even for a paste vendor", () => {
    // The TUI owns no post-spawn paste hook yet, so it pins "argv" —
    // dropping the prompt silently would be worse than the engine's loud
    // unknown-command exit.
    const launch = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "kimi", repo: "/repo" },
      worktreePath: "/repo/.worktrees/task-1",
      shell: "/bin/zsh",
      argv: ["kimi"],
      promptIntent: { kind: "explicit", prompt: "fix it" },
      firstMessageDelivery: "argv",
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
    })

    expect(launch.command[2]).toContain("kimi 'fix it'")
    expect(launch.firstMessage).toBeUndefined()
  })

  test("is owned by the engine layer without importing the retiring tmux runtime", () => {
    const source = fs.readFileSync(new URL("../../src/engine/session-launch.ts", import.meta.url), "utf8")
    expect(source).not.toMatch(/from ["'][^"']*tmux/)
  })

  test("runs marker-gated repo init before the repo first message", () => {
    const worktree = makeWorktree({
      ".rove/init.sh": "export READY=1",
      ".rove/init-prompt.md": "read the repo docs",
    })
    const launch = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "claude", repo: worktree },
      worktreePath: worktree,
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "repo-init" },
      initTimeoutSeconds: 7,
      protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
    })
    const script = launch.command[2]

    expect(script).toContain("sh .rove/init.sh")
    expect(script).toContain("sleep 7;")
    expect(script).toContain("worktree-init")
    expect(script.indexOf("sh .rove/init.sh")).toBeLessThan(script.indexOf("claude 'read the repo docs'"))
    expect(launch.initMarkerPath).toContain("worktree-init")
    expect(launch.initTimeoutMs).toBe(7_000)
  })

  test("writes the init marker in the form the shell reads, not the OS's", () => {
    // The marker is interpolated into a POSIX script that Git Bash runs.
    // `[ -f 'C:\wt\.kobe\worktree-init\ab12' ]` reads `\w` as an escape, so
    // the gate would never match and repo init would re-run on every launch.
    const script = engineLaunchLine("claude", {
      initScript: "echo hi",
      markerPath: "C:\\wt\\.kobe\\worktree-init\\ab12",
      platform: "win32",
    })

    expect(script).toContain("[ ! -f '/c/wt/.kobe/worktree-init/ab12' ]")
    expect(script).toContain("mkdir -p '/c/wt/.kobe/worktree-init'")
    expect(script).not.toContain("\\wt\\")
  })

  test("leaves a POSIX marker path exactly as it is", () => {
    const script = engineLaunchLine("claude", {
      initScript: "echo hi",
      markerPath: "/repo/.kobe/worktree-init/ab12",
      platform: "linux",
    })

    expect(script).toContain("[ ! -f '/repo/.kobe/worktree-init/ab12' ]")
    expect(script).toContain("mkdir -p '/repo/.kobe/worktree-init'")
  })

  // These run the GENERATED script for real. The bugs here are both about
  // what an outside observer (the paste spawner; the next tab's shell) can
  // see afterwards, which a substring assertion on the script text cannot
  // settle — only executing it and looking at the filesystem can.
  describe("running the generated init script", () => {
    function launchScript(initScript: string, markerPath: string): string {
      return engineLaunchLine("printenv ROVE_INIT_PROBE || echo UNSET", {
        initScript,
        markerPath,
        timeoutSeconds: 10,
        platform: "linux",
      })
    }

    let runSeq = 0
    // The launch script leaves its `sleep <timeout>` watchdog child running
    // after init returns. Handed our stdout PIPE it keeps that pipe open, and
    // execFileSync then blocks for the WHOLE init budget after the shell
    // itself is long gone — so route the script's output to a file and wait
    // on the shell only.
    function runLaunch(cwd: string, script: string, env?: NodeJS.ProcessEnv): string {
      runSeq += 1
      const out = path.join(cwd, `run-${runSeq}.log`)
      execFileSync("/bin/sh", ["-c", `{ ${script}\n} > ${JSON.stringify(out)} 2>&1`], {
        cwd,
        stdio: "ignore",
        ...(env ? { env } : {}),
      })
      return fs.readFileSync(out, "utf8")
    }

    function scratch(): { dir: string; marker: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-init-run-"))
      tempDirs.push(dir)
      return { dir, marker: path.join(dir, "state", "worktree-init", "abc123") }
    }

    // B1: while the marker only appeared on a zero exit, a repo whose init
    // script fails left the paste-delivery spawner polling a file that would
    // never exist — two minutes of empty composer per fresh task.
    test("records the init outcome in the marker on BOTH the success and failure branches", () => {
      for (const [initScript, expected] of [
        ["echo ok", "0"],
        ["echo nope; exit 3", "3"],
      ] as const) {
        const { dir, marker } = scratch()
        runLaunch(dir, launchScript(initScript, marker))
        expect(fs.existsSync(marker)).toBe(true)
        expect(fs.readFileSync(marker, "utf8")).toBe(expected)
      }
    })

    // A recorded failure must still retry on the next launch, which is what
    // an absent marker used to mean.
    test("re-runs init after a recorded failure, and stops re-running after a success", () => {
      const { dir, marker } = scratch()
      const counter = path.join(dir, "runs")
      const bump = `printf x >> ${JSON.stringify(counter)}`
      const runs = () => (fs.existsSync(counter) ? fs.readFileSync(counter, "utf8").length : 0)

      runLaunch(dir, launchScript(`${bump}; exit 1`, marker))
      expect(runs()).toBe(1)
      runLaunch(dir, launchScript(`${bump}; exit 1`, marker)) // failure recorded → retry
      expect(runs()).toBe(2)
      runLaunch(dir, launchScript(bump, marker)) // succeeds this time
      expect(runs()).toBe(3)
      runLaunch(dir, launchScript(bump, marker)) // success recorded → skipped
      expect(runs()).toBe(3)
    })

    // B2: the marker is per-WORKTREE, so restoring the env inside its guard
    // meant only the first session in a worktree ever saw what init exported.
    test("restores the init script's exports for EVERY session, not just the first", () => {
      const { dir, marker } = scratch()
      const script = launchScript("export ROVE_INIT_PROBE=1", marker)
      expect(runLaunch(dir, script).trim()).toBe("1")
      expect(runLaunch(dir, script).trim()).toBe("1")
      expect(runLaunch(dir, script).trim()).toBe("1")
    })

    test("keeps the env dump 0600 — an init script's exports are where a key would be", () => {
      const { dir, marker } = scratch()
      runLaunch(dir, launchScript("export ROVE_INIT_PROBE=1", marker))
      expect(fs.statSync(`${marker}.env`).mode & 0o777).toBe(0o600)
    })

    // The dump is the DELTA of `export -p`, not the whole environment: it is
    // sourced by every later tab, and a whole dump would re-export tab-1's
    // ROVE_TAB_ID over each of them (hooks would misattribute every event).
    test("carries only what init exported — never the first session's own identity", () => {
      const { dir, marker } = scratch()
      runLaunch(dir, launchScript("export ROVE_INIT_PROBE=1", marker), { ...process.env, ROVE_TAB_ID: "tab-1" })
      const dump = fs.readFileSync(`${marker}.env`, "utf8")
      expect(dump).toContain("ROVE_INIT_PROBE")
      expect(dump).not.toContain("ROVE_TAB_ID")
    })

    test("a failed init leaves no env dump behind", () => {
      const { dir, marker } = scratch()
      runLaunch(dir, launchScript("export ROVE_INIT_PROBE=1; exit 1", marker))
      expect(fs.existsSync(`${marker}.env`)).toBe(false)
    })

    // Pre-0.9.101 launches marked success by TOUCHING the marker, so any home
    // that has been around a while is full of EMPTY ones — and the worktree
    // name pool is finite, so a fresh task lands on one routinely. The shell
    // re-runs init on an empty marker; a reader that only asked `existsSync`
    // said the opposite and probed for an engine that was still a `bun
    // install` away, which is how `add` came back SESSION_FAILED with a
    // progress bar as the reason for a task that then started fine.
    test("an empty pre-0.9.101 marker re-runs init, and the shared predicate agrees", () => {
      const { dir, marker } = scratch()
      fs.mkdirSync(path.dirname(marker), { recursive: true })
      fs.writeFileSync(marker, "")
      expect(initMarkerSaysFinished(marker)).toBe(false)

      const counter = path.join(dir, "runs")
      runLaunch(dir, launchScript(`printf x >> ${JSON.stringify(counter)}`, marker))

      expect(fs.readFileSync(counter, "utf8")).toBe("x")
      // …and this launch replaced it with a recorded code, so the same
      // worktree path never pays for it twice.
      expect(fs.readFileSync(marker, "utf8")).toBe("0")
      expect(initMarkerSaysFinished(marker)).toBe(true)
    })
  })

  describe("initMarkerSaysFinished", () => {
    // The question every reader asks is "has this run of init STOPPED", not
    // "does the file exist" — the launch script deletes the marker before
    // re-running, so a recorded failure ("1") is finished and the retry shows
    // up as the absent state below.
    test.each([
      ["absent — init never ran, or this launch deleted it to retry", null, false],
      ["empty — a pre-0.9.101 success touch the shell will re-run", "", false],
      ["a recorded success", "0", true],
      ["a recorded failure", "1", true],
    ])("%s", (_label, contents, finished) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-init-marker-"))
      tempDirs.push(dir)
      const marker = path.join(dir, "marker")
      if (contents !== null) fs.writeFileSync(marker, contents)
      expect(initMarkerSaysFinished(marker)).toBe(finished)
    })
  })

  test("injects the worktree protocol only for regular tasks", () => {
    const regular = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "claude" },
      worktreePath: "/worktree",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
      protocolGates: { status: () => true, notes: () => false, dispatcher: () => true },
    })
    const main = buildEngineSessionLaunch({
      task: { id: "main-1", kind: "main", vendor: "claude" },
      worktreePath: "/repo",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
      protocolGates: { status: () => true, notes: () => false, dispatcher: () => true },
    })

    expect(regular.command[2]).toContain("report it by running")
    expect(regular.command[2]).not.toContain("DISPATCHER")
    expect(main.command[2]).toContain("DISPATCHER")
    expect(main.command[2]).not.toContain("report it by running")
  })

  test("seeds a worktree session with the repo's field notes, and never the main session", () => {
    // The main session is the dispatcher — it gets notes pushed to it live,
    // so reading the store for it would double-deliver.
    const readNotes = (repoRoot: string) => {
      seen.push(repoRoot)
      return [{ text: "build needs --no-sandbox", author: "worker A" }]
    }
    const seen: string[] = []
    const card = buildEngineSessionLaunch({
      task: { id: "task-1", kind: "task", vendor: "claude", repo: "/repo" },
      worktreePath: "/worktree",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
      protocolGates: { status: () => false, notes: () => true, dispatcher: () => false },
      readNotes,
    })
    const main = buildEngineSessionLaunch({
      task: { id: "main-1", kind: "main", vendor: "claude", repo: "/repo" },
      worktreePath: "/repo",
      shell: "/bin/zsh",
      argv: ["claude"],
      promptIntent: { kind: "none" },
      protocolGates: { status: () => false, notes: () => true, dispatcher: () => true },
      readNotes,
    })

    expect(card.command[2]).toContain("build needs --no-sandbox")
    expect(main.command[2]).not.toContain("build needs --no-sandbox")
    // Read once, for the card only — keyed by the task's source repo.
    expect(seen).toEqual(["/repo"])
  })
})

describe("remote projects", () => {
  // The experimental SSH-backed projects feature routes git through an exec
  // host, but the PTY host spawns locally against a raw cwd — so a remote
  // task used to start an engine on THIS machine in a worktree that lives on
  // the other one. `rove add --remote` and the Settings toggle both say SSH
  // engine launch is unimplemented; the guard makes the code say it too.
  //
  // Asserted here rather than per caller: every launch path — Workspace host
  // tab open, `rove api send`, prompted `add` — funnels through this builder.
  const remote = {
    shell: "/bin/zsh",
    argv: ["claude"],
    promptIntent: { kind: "explicit" as const, prompt: "go" },
    protocolGates: { status: () => false, notes: () => false, dispatcher: () => false },
  }

  test("refuses a launch whose project is an ssh:// key", () => {
    expect(() =>
      buildEngineSessionLaunch({
        task: { id: "task-r", kind: "task", vendor: "claude", repo: "ssh://me@box/srv/app" },
        worktreePath: "/srv/rove/task-r",
        ...remote,
      }),
    ).toThrow(/hosted engine launch over SSH is not implemented/)
  })

  test("refuses one whose worktree is remote even when the repo key reads local", () => {
    expect(() =>
      buildEngineSessionLaunch({
        task: { id: "task-r", kind: "task", vendor: "claude", repo: "/repo" },
        worktreePath: "ssh://me@box/srv/rove/task-r",
        ...remote,
      }),
    ).toThrow(/hosted engine launch over SSH is not implemented/)
  })

  test("a local project is untouched", () => {
    expect(() =>
      buildEngineSessionLaunch({
        task: { id: "task-l", kind: "task", vendor: "claude", repo: "/repo" },
        worktreePath: "/repo/.worktrees/task-l",
        ...remote,
      }),
    ).not.toThrow()
  })
})
