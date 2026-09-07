import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const source = new URL("../../src/", import.meta.url).pathname

describe("global legacy hook cleanup", () => {
  it.each(["unset", "global", "absolute", "repo"])("uses the active profile with %s persisted setup", (mode) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-hook-profile-"))
    const profile = path.join(home, "selected")
    const defaultFile = path.join(home, ".claude/settings.json")
    const selectedFile = path.join(profile, "settings.json")
    const explicitFile = path.join(home, "repo/.claude/settings.json")
    const own = { type: "command", command: "kobe hook worktree-created" }
    const user = { type: "command", command: "echo worktree-created", timeout: 9 }
    const raw = JSON.stringify({
      user: true,
      hooks: { WorktreeCreate: [{ matcher: "*", extra: true, hooks: [own, user] }] },
    })
    for (const file of [defaultFile, selectedFile, explicitFile]) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, raw)
    }
    const stored =
      mode === "global"
        ? "global"
        : mode === "absolute"
          ? explicitFile
          : mode === "repo"
            ? `repo:${path.join(home, "repo")}`
            : undefined
    const script = `
      import { homedir } from 'node:os';
      import { vendorConfigHome } from ${JSON.stringify(`${source}engine/vendor-home.ts`)};
      if (homedir() !== process.env.FIXTURE_HOME) throw Error('unsafe home');
      for (const v of ['claude','codex','kimi','copilot']) if (!vendorConfigHome(v).startsWith(homedir() + '/')) throw Error('unsafe profile');
      const { setPersistedString } = await import(${JSON.stringify(`${source}state/repos.ts`)});
      const { ensureGlobalKobeHooks } = await import(${JSON.stringify(`${source}cli/hook-cmd.ts`)});
      const stored = ${JSON.stringify(stored) ?? "undefined"};
      if (stored !== undefined) setPersistedString('externalWorktreeSync', stored);
      await ensureGlobalKobeHooks();
      await ensureGlobalKobeHooks();
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
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(fs.readFileSync(defaultFile, "utf8")).toBe(raw)
    const selected = JSON.parse(fs.readFileSync(selectedFile, "utf8"))
    expect(selected.user).toBe(true)
    expect(selected.hooks.WorktreeCreate).toEqual([{ matcher: "*", extra: true, hooks: [user] }])
    if (mode === "absolute" || mode === "repo") {
      expect(JSON.parse(fs.readFileSync(explicitFile, "utf8")).hooks.WorktreeCreate).toEqual([
        { matcher: "*", extra: true, hooks: [user] },
      ])
    } else {
      expect(fs.readFileSync(explicitFile, "utf8")).toBe(raw)
    }
  })
})
