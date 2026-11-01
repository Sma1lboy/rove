import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Env overrides that would point an engine's home outside the fixture. */
const ENGINE_HOME_VARS = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "COPILOT_HOME",
  "KIMI_CODE_HOME",
  "PI_CODING_AGENT_DIR",
  "GROK_HOME",
  "XDG_CONFIG_HOME",
]

/** A throwaway home plus a fake bundled skill. Callers redirect `os.homedir()` to `home`. */
export function skillHomeFixture(bundledVersion: number) {
  const root = mkdtempSync(join(tmpdir(), "rove-skill-"))
  const home = join(root, "home")
  const source = join(root, "bundled")
  mkdirSync(home)
  const skillBody = (version: number) => `---\nname: rove\n---\n<!-- rove-skill-version: ${version} -->\n`
  mkdirSync(join(source, "references"), { recursive: true })
  writeFileSync(join(source, "SKILL.md"), skillBody(bundledVersion))
  writeFileSync(join(source, "references", "ref.md"), "ref")
  const saved = ENGINE_HOME_VARS.map((k) => [k, process.env[k]] as const)
  for (const k of ENGINE_HOME_VARS) Reflect.deleteProperty(process.env, k)
  return {
    home,
    source,
    skillBody,
    /** Write a SKILL.md stamped `version` at `<home>/<rel>/SKILL.md`. */
    installAt(rel: string, version: number): string {
      const dir = join(home, rel)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "SKILL.md"), skillBody(version))
      return dir
    },
    cleanup(): void {
      for (const [k, v] of saved) {
        if (v === undefined) Reflect.deleteProperty(process.env, k)
        else process.env[k] = v
      }
      rmSync(root, { recursive: true, force: true })
    },
  }
}
