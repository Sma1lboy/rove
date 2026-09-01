/**
 * A `[[settings]]` row is an env var injected into the plugin's own process:
 * the manifest declares the key, Settings → Plugins renders it as an ordinary
 * editable row, and the value lands as `KEY=value` in the config `.env` that
 * plugin commands source. So a manifest can hand the user a row labelled
 * "Search path" that actually rewrites `PATH` — the label is plugin-owned
 * copy, and nothing about the row says what the key steers.
 *
 * These pin both halves: which keys a manifest may declare at all, and that a
 * value can never break out of its own line.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { pluginConfigDir } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { readPluginSettings, writePluginSettings } from "@sma1lboy/kobe-daemon/plugins/settings-env"
import { afterEach, describe, expect, it } from "vitest"

const dirs: string[] = []
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const HEAD = 'id = "e.p"\nname = "P"\nversion = "1.0.0"\nmin_rove_version = "0.1.0"\n'

function manifestWithSetting(body: string): string {
  return `${HEAD}[[settings]]\n${body}\n`
}

describe("settings keys a manifest may declare", () => {
  it("accepts a conventional plugin-namespaced key", () => {
    const { manifest } = parsePluginManifest(
      manifestWithSetting('key = "ROVE_EXAMPLE_MODE"\nlabel = "Mode"\ntype = "string"'),
    )
    expect(manifest.settings[0]?.key).toBe("ROVE_EXAMPLE_MODE")
  })

  // Each of these would otherwise become an editable row whose innocuous
  // label hides that it redirects binary resolution, library loading, or a
  // subprocess the plugin shells out to.
  it.each(["PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "GIT_SSH_COMMAND", "BASH_ENV", "HOME"])(
    "rejects the process-steering key %s",
    (key) => {
      expect(() =>
        parsePluginManifest(manifestWithSetting(`key = "${key}"\nlabel = "Search path"\ntype = "string"`)),
      ).toThrow(/reserved/)
    },
  )

  // An API-key-shaped name is the FEATURE — a plugin asking for a token is
  // why `[[settings]]` exists. The line is mechanism, not sensitivity.
  it("still allows a plugin to ask for a token", () => {
    const { manifest } = parsePluginManifest(
      manifestWithSetting('key = "OPENAI_API_KEY"\nlabel = "API key"\ntype = "secret"'),
    )
    expect(manifest.settings[0]).toMatchObject({ key: "OPENAI_API_KEY", type: "secret" })
  })

  it.each([
    ['key = "A B"', "a space"],
    ['key = "FOO=BAR"', "an embedded assignment"],
    ['key = "FOO\\nBAR"', "a newline"],
    ['key = "2FA"', "a leading digit"],
    ['key = "FOO-BAR"', "a dash"],
    ['key = "# comment"', "shell syntax"],
  ])("rejects %s (%s) as not an env var name", (keyLine) => {
    expect(() => parsePluginManifest(manifestWithSetting(`${keyLine}\nlabel = "L"\ntype = "string"`))).toThrow(
      /not a valid env var name/,
    )
  })

  it("rejects the whole manifest rather than dropping the bad row", () => {
    const toml = `${HEAD}[[settings]]\nkey = "GOOD_ONE"\nlabel = "Fine"\ntype = "string"\n\n[[settings]]\nkey = "PATH"\nlabel = "Search path"\ntype = "string"\n`
    expect(() => parsePluginManifest(toml)).toThrow()
  })
})

describe("settings values stay on one line", () => {
  it("strips a newline that would forge a second KEY= assignment", () => {
    const home = tmp("kobe-setkey-nl-")
    writePluginSettings("p", { ROVE_P_MODE: "fast\nLD_PRELOAD=/tmp/evil.so" }, home)
    const text = readFileSync(join(pluginConfigDir("p", home), ".env"), "utf8")
    expect(text.trimEnd().split("\n")).toEqual(["ROVE_P_MODE=fastLD_PRELOAD=/tmp/evil.so"])
    expect(readPluginSettings("p", home).LD_PRELOAD).toBeUndefined()
  })

  it("strips a carriage return too, and on the update path as well as the insert path", () => {
    const home = tmp("kobe-setkey-cr-")
    writePluginSettings("p", { ROVE_P_MODE: "one" }, home)
    writePluginSettings("p", { ROVE_P_MODE: "two\r\nPATH=/tmp/bin" }, home)
    const text = readFileSync(join(pluginConfigDir("p", home), ".env"), "utf8")
    expect(text.trimEnd().split("\n")).toEqual(["ROVE_P_MODE=twoPATH=/tmp/bin"])
    expect(readPluginSettings("p", home).PATH).toBeUndefined()
  })
})
