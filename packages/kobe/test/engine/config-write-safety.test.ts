import { execFile, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClaudeHookAdapter } from "../../src/engine/claude-code-local/hook-adapter.ts"
import { trustClaudeWorktree } from "../../src/engine/claude-code-local/trust.ts"
import { CodexHookAdapter } from "../../src/engine/codex-local/hook-adapter.ts"
import { trustCodexWorktree } from "../../src/engine/codex-local/trust.ts"
import { kimiTrustFilePath, trustKimiWorktree } from "../../src/engine/kimi-local/trust.ts"
import {
  MAX_SHARED_CONFIG_BYTES,
  updateSharedJson,
  updateSharedJsonSync,
} from "../../src/engine/shared-config-write.ts"

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "rove-config-safety-"))
  vi.stubEnv("ROVE_HOME_DIR", path.join(home, "rove"))
})
afterEach(() => vi.unstubAllEnvs())

function config(relative: string, content: string): string {
  const file = path.join(home, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

describe("Claude trust preserves invalid JSON", () => {
  it.each(["", " \n ", '{"user":', "null", "[]", '{"projects":[]}', '{"projects":{"/fixture/test":null}}'])(
    "refuses %j and keeps its exact bytes",
    (raw) => {
      const file = config(".claude.json", raw)
      expect(() => trustClaudeWorktree("/fixture/test", home)).toThrow()
      expect(fs.readFileSync(file, "utf8")).toBe(raw)
      fs.writeFileSync(file, '{"keep":42}')
      expect(() => trustClaudeWorktree("/fixture/test", home)).not.toThrow()
      expect(JSON.parse(fs.readFileSync(file, "utf8")).keep).toBe(42)
    },
  )
})

describe("Codex trust preserves TOML", () => {
  it.each([
    'model = "unterminated',
    '[projects."/fixture/test"]\ntrust_level = "trusted"\n[projects."/fixture/test"]\ntrust_level = "trusted"\ncustom = true\n',
    '[projects."/fixture/test"]\ntrust_level = "untrusted"\n[projects."/fixture/test"]\ntrust_level = "trusted"\n',
  ])("refuses malformed config %j without changing bytes", (raw) => {
    const file = config(".codex/config.toml", raw)
    expect(() => trustCodexWorktree("/fixture/test", home)).toThrow()
    expect(fs.readFileSync(file, "utf8")).toBe(raw)
    expect(fs.existsSync(path.join(home, ".codex/config.toml.rove.lock"))).toBe(false)
  })

  it("preserves comments, multiline content and exact existing bytes on append", () => {
    const raw =
      '# user note\r\nmodel = "gpt-5"\r\nnote = """\n[projects."/fixture/test"]\ntrust_level = "trusted"\n"""\n'
    const file = config(".codex/config.toml", raw)
    trustCodexWorktree("/fixture/test", home)
    const result = fs.readFileSync(file, "utf8")
    expect(result.startsWith(raw)).toBe(true)
    expect(result.slice(raw.length)).toContain('[projects."/fixture/test"]')
    trustCodexWorktree("/fixture/test", home)
    expect(fs.readFileSync(file, "utf8")).toBe(result)
  })

  it.each(["", " \n # empty config\n", "[projects.'/fixture/test']\ntrust_level = \"untrusted\"\n"])(
    "accepts valid TOML without duplicating an existing project",
    (raw) => {
      const file = config(".codex/config.toml", raw)
      trustCodexWorktree("/fixture/test", home)
      const result = fs.readFileSync(file, "utf8")
      if (raw.includes("untrusted")) expect(result).toBe(raw)
      else expect(result.startsWith(raw)).toBe(true)
    },
  )

  it("leaves the original untouched when duplicate repairs exceed the bound", () => {
    const stanza = '[projects."/fixture/old"]\ntrust_level = "trusted"\n'
    const raw = `# user config\n${Array.from({ length: 7 }, () => stanza).join("\n")}`
    const file = config(".codex/config.toml", raw)
    expect(() => trustCodexWorktree("/fixture/test", home)).toThrow("leaving it unchanged")
    expect(fs.readFileSync(file, "utf8")).toBe(raw)
  })

  it("does not write or release a rival's lock after timeout", () => {
    const file = config(".codex/config.toml", "# keep me\n")
    const lock = config(".codex/config.toml.rove.lock", String(process.pid))
    expect(() => trustCodexWorktree("/fixture/test", home)).toThrow("Timed out")
    expect(fs.readFileSync(file, "utf8")).toBe("# keep me\n")
    expect(fs.readFileSync(lock, "utf8")).toBe(String(process.pid))
  }, 10_000)
})

describe("hook writers", () => {
  it.each([new ClaudeHookAdapter(), new CodexHookAdapter()])(
    "preserves rejected files for $vendor",
    async (adapter) => {
      const file = config("hooks.json", "")
      for (const raw of [
        "",
        " \n",
        "{broken",
        "null",
        "[]",
        '{"hooks":[]}',
        '{"hooks":{"Stop":false}}',
        '{"hooks":{"Stop":[{"hooks":null}]}}',
      ]) {
        fs.writeFileSync(file, raw)
        await adapter.installActivityHooks(file)
        await adapter.removeActivityHooks(file)
        await adapter.removeWorktreeSyncHook(file)
        await adapter.removeWorktreeWatchHook(file)
        expect(fs.readFileSync(file, "utf8")).toBe(raw)
      }
    },
  )
})

describe("shared config IO rejection", () => {
  const syncWrite = (file: string) =>
    updateSharedJsonSync(
      file,
      () => ({}),
      () => '{"changed":true}',
    )
  const asyncWrite = (file: string) =>
    updateSharedJson(
      file,
      () => ({}),
      () => '{"changed":true}',
    )

  it("passes existing empty text distinctly from missing to the loader", async () => {
    const seen: (string | undefined)[] = []
    const load = (raw: string | undefined) => {
      seen.push(raw)
      return undefined
    }
    const file = config("empty.json", "")
    updateSharedJsonSync(file, load, () => undefined)
    await updateSharedJson(file, load, () => undefined)
    updateSharedJsonSync(path.join(home, "missing.json"), load, () => undefined)
    await updateSharedJson(path.join(home, "missing.json"), load, () => undefined)
    expect(seen).toEqual(["", "", undefined, undefined])
  })

  it("rejects oversized files before calling the merge and preserves bytes", async () => {
    const file = config("huge.json", "original prefix")
    fs.truncateSync(file, MAX_SHARED_CONFIG_BYTES + 1)
    const before = fs.statSync(file)
    expect(() => syncWrite(file)).toThrow()
    await expect(asyncWrite(file)).rejects.toThrow()
    expect(fs.statSync(file).size).toBe(before.size)
    expect(fs.statSync(file).mtimeMs).toBe(before.mtimeMs)
    fs.writeFileSync(file, "{}")
    await expect(asyncWrite(file)).resolves.toBeUndefined()
  })

  it("rejects directories and permission errors without converting them to missing", async () => {
    const directory = path.join(home, "directory")
    fs.mkdirSync(directory)
    expect(() => syncWrite(directory)).toThrow()
    await expect(asyncWrite(directory)).rejects.toThrow()
    const file = config("unreadable.json", "{}")
    fs.chmodSync(file, 0)
    try {
      if (process.getuid?.() !== 0) {
        expect(() => syncWrite(file)).toThrow()
        await expect(asyncWrite(file)).rejects.toThrow()
      }
    } finally {
      fs.chmodSync(file, 0o600)
    }
    expect(fs.readFileSync(file, "utf8")).toBe("{}")
  })

  it("releases the lock after a throwing merge", async () => {
    const file = config("throws.json", "{}")
    const fail = () => {
      throw new Error("fixture merge failed")
    }
    expect(() => updateSharedJsonSync(file, () => ({}), fail)).toThrow("fixture merge failed")
    await expect(updateSharedJson(file, () => ({}), fail)).rejects.toThrow("fixture merge failed")
    await asyncWrite(file)
    expect(fs.readFileSync(file, "utf8")).toBe('{"changed":true}')
  })

  it("serializes real processes writing the same JSON config", async () => {
    const file = config("concurrent.json", '{"user":true}')
    const source = new URL("../../src/engine/shared-config-write.ts", import.meta.url).pathname
    const vendor = new URL("../../src/engine/vendor-home.ts", import.meta.url).pathname
    const children = ["a", "b", "c", "d"].map((key) => {
      const script = `
        import { homedir } from 'node:os';
        import { vendorConfigHome } from ${JSON.stringify(vendor)};
        if (homedir() !== process.env.FIXTURE_HOME) throw Error('unsafe home');
        for (const v of ['claude','codex','kimi','copilot']) if (!vendorConfigHome(v).startsWith(homedir() + '/')) throw Error('unsafe profile');
        const { updateSharedJson } = await import(${JSON.stringify(source)});
        await updateSharedJson(${JSON.stringify(file)}, raw => JSON.parse(raw), doc => JSON.stringify({...doc, [${JSON.stringify(key)}]: true}));
      `
      return new Promise<void>((resolve, reject) => {
        execFile(
          "bun",
          ["-e", script],
          {
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
            timeout: 10_000,
          },
          (error) => (error ? reject(error) : resolve()),
        )
      })
    })
    await Promise.all(children)
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ user: true, a: true, b: true, c: true, d: true })
    expect(fs.readdirSync(home).filter((name) => name.includes(".tmp"))).toEqual([])
  })

  it("refuses FIFO config paths in a bounded child process", () => {
    const claude = path.join(home, ".claude.json")
    const codex = path.join(home, ".codex/config.toml")
    const hooks = path.join(home, "hooks.json")
    fs.mkdirSync(path.dirname(codex))
    for (const file of [claude, codex, hooks]) expect(spawnSync("mkfifo", [file]).status).toBe(0)
    const engine = new URL("../../src/engine/", import.meta.url).pathname
    const script = `
      import { homedir } from 'node:os';
      import { vendorConfigHome } from ${JSON.stringify(`${engine}vendor-home.ts`)};
      if (homedir() !== process.env.FIXTURE_HOME) throw Error('unsafe home');
      for (const v of ['claude', 'codex', 'kimi', 'copilot']) if (!vendorConfigHome(v).startsWith(homedir() + '/')) throw Error('unsafe profile');
      const { trustClaudeWorktree } = await import(${JSON.stringify(`${engine}claude-code-local/trust.ts`)});
      const { trustCodexWorktree } = await import(${JSON.stringify(`${engine}codex-local/trust.ts`)});
      const { ClaudeHookAdapter } = await import(${JSON.stringify(`${engine}claude-code-local/hook-adapter.ts`)});
      for (const trust of [trustClaudeWorktree, trustCodexWorktree]) {
        let refused = false; try { trust('/fixture/fifo', homedir()) } catch { refused = true }
        if (!refused) throw Error('expected refusal');
      }
      await new ClaudeHookAdapter().installActivityHooks(${JSON.stringify(hooks)});
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
      timeout: 3_000,
      encoding: "utf8",
    })
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    for (const file of [claude, codex, hooks]) expect(fs.lstatSync(file).isFIFO()).toBe(true)
  })
})

describe("Kimi exclusive creation", () => {
  it("keeps existing malformed records and dangling symlinks", () => {
    const file = kimiTrustFilePath("/fixture/test", home)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "{ malformed")
    trustKimiWorktree("/fixture/test", home)
    expect(fs.readFileSync(file, "utf8")).toBe("{ malformed")
    const linked = kimiTrustFilePath("/fixture/link", home)
    const missing = path.join(home, "missing-target")
    fs.symlinkSync(missing, linked)
    trustKimiWorktree("/fixture/link", home)
    expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true)
    expect(fs.existsSync(missing)).toBe(false)
  })
})
