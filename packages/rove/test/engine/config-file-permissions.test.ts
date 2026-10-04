import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const engine = new URL("../../src/engine/", import.meta.url).pathname

describe("private config permissions", () => {
  it.each(["sync", "async", "codex"])("keeps %s writes private under umask 022", (writer) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-config-mode-"))
    const script = `
      import assert from 'node:assert/strict';
      import { homedir } from 'node:os';
      import { mkdirSync, writeFileSync, statSync } from 'node:fs';
      import { join } from 'node:path';
      import { vendorConfigHome } from ${JSON.stringify(`${engine}vendor-home.ts`)};
      assert.equal(homedir(), process.env.FIXTURE_HOME);
      for (const v of ['claude','codex','kimi','copilot']) assert(vendorConfigHome(v).startsWith(homedir() + '/'));
      const { updateSharedJson, updateSharedJsonSync } = await import(${JSON.stringify(`${engine}shared-config-write.ts`)});
      const { trustCodexWorktree } = await import(${JSON.stringify(`${engine}codex-local/trust.ts`)});
      process.umask(0o022);
      for (const existing of [true, false]) {
        const base = join(homedir(), existing ? 'existing' : 'new');
        const file = ${JSON.stringify(writer)} === 'codex' ? join(base, '.codex/config.toml') : join(base, 'settings.json');
        mkdirSync(join(base, '.codex'), { recursive: true });
        if (existing) writeFileSync(file, ${JSON.stringify(writer)} === 'codex' ? '# private config\\n' : '{"private":true}', { mode: 0o600 });
        if (${JSON.stringify(writer)} === 'codex') trustCodexWorktree('/fixture/private', base);
        else {
          const write = ${JSON.stringify(writer)} === 'sync' ? updateSharedJsonSync : updateSharedJson;
          await write(file, raw => raw === undefined ? {} : JSON.parse(raw), doc => JSON.stringify({...doc, updated: true}));
        }
        assert.equal(statSync(file).mode & 0o777, 0o600);
      }
    `
    const child = spawnSync("bun", ["-e", script], {
      env: {
        ...process.env,
        HOME: home,
        FIXTURE_HOME: home,
        ROVE_HOME_DIR: home,
        CLAUDE_CONFIG_DIR: "",
        CODEX_HOME: "",
        KIMI_CODE_HOME: "",
        COPILOT_HOME: "",
      },
      timeout: 5_000,
      encoding: "utf8",
    })
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
  })
})
