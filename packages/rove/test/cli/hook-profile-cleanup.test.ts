import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const source = new URL("../../src/", import.meta.url).pathname

/** Seeds the same hook file in three places, runs the cleanup twice in a child bun, and returns what it left. */
function runCleanup(stored: (home: string) => string | undefined) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-hook-profile-"))
  const profile = path.join(home, "selected")
  const defaultFile = path.join(home, ".claude/settings.json")
  const selectedFile = path.join(profile, "settings.json")
  const explicitFile = path.join(home, "repo/.claude/settings.json")
  const own = { type: "command", command: "rove hook worktree-created" }
  const user = { type: "command", command: "echo worktree-created", timeout: 9 }
  const raw = JSON.stringify({
    user: true,
    hooks: { WorktreeCreate: [{ matcher: "*", extra: true, hooks: [own, user] }] },
  })
  for (const file of [defaultFile, selectedFile, explicitFile]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, raw)
  }
  const script = `
      import { homedir } from 'node:os';
      import { vendorConfigHome } from ${JSON.stringify(`${source}engine/vendor-home.ts`)};
      if (homedir() !== process.env.FIXTURE_HOME) throw Error('unsafe home');
      for (const v of ['claude','codex','kimi','copilot']) if (!vendorConfigHome(v).startsWith(homedir() + '/')) throw Error('unsafe profile');
      const { setPersistedString } = await import(${JSON.stringify(`${source}state/repos.ts`)});
      const { ensureGlobalRoveHooks } = await import(${JSON.stringify(`${source}cli/hook-cmd.ts`)});
      const stored = ${JSON.stringify(stored(home)) ?? "undefined"};
      if (stored !== undefined) setPersistedString('externalWorktreeSync', stored);
      await ensureGlobalRoveHooks();
      await ensureGlobalRoveHooks();
    `
  const child = spawnSync("bun", ["-e", script], {
    env: {
      ...process.env,
      HOME: home,
      FIXTURE_HOME: home,
      ROVE_HOME_DIR: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      CLAUDE_CONFIG_DIR: profile,
      CODEX_HOME: "",
      KIMI_CODE_HOME: "",
      COPILOT_HOME: "",
    },
    timeout: 10_000,
    encoding: "utf8",
  })
  const read = (file: string) => fs.readFileSync(file, "utf8")
  const result = { child, raw, cleaned: [{ matcher: "*", extra: true, hooks: [user] }] }
  const files = { default: read(defaultFile), selected: read(selectedFile), explicit: read(explicitFile) }
  fs.rmSync(home, { recursive: true, force: true })
  return { ...result, files }
}

function expectActiveProfileCleaned(run: ReturnType<typeof runCleanup>): void {
  expect(run.child.error).toBeUndefined()
  expect(run.child.status, run.child.stderr).toBe(0)
  expect(run.files.default).toBe(run.raw)
  const selected = JSON.parse(run.files.selected)
  expect(selected.user).toBe(true)
  expect(selected.hooks.WorktreeCreate).toEqual(run.cleaned)
}

describe("global legacy hook cleanup", () => {
  it.each([
    ["unset", () => undefined],
    ["global", () => "global"],
  ])("uses the active profile with %s persisted setup and leaves the repo file alone", (_mode, stored) => {
    const run = runCleanup(stored)
    expectActiveProfileCleaned(run)
    expect(run.files.explicit).toBe(run.raw)
  })

  it.each([
    ["absolute", (home: string) => path.join(home, "repo/.claude/settings.json")],
    ["repo", (home: string) => `repo:${path.join(home, "repo")}`],
  ])("uses the active profile with %s persisted setup and cleans the configured file too", (_mode, stored) => {
    const run = runCleanup(stored)
    expectActiveProfileCleaned(run)
    expect(JSON.parse(run.files.explicit).hooks.WorktreeCreate).toEqual(run.cleaned)
  })
})
