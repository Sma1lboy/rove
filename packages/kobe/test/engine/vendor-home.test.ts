/**
 * `vendorConfigHome` is the single derivation of "where does vendor X keep
 * its state" that six engine modules used to re-write by hand. What is pinned
 * here is the part a copy gets wrong silently: the exact env-var name per
 * vendor, the exact default dir, and the empty-override rule.
 *
 * The empty-override rule mattered before this module existed: the four
 * resolvers disagreed. `claudeGlobalConfigPath` used `override ? … : …`
 * (treating `""` as absent) while the other three used `override ?? …` —
 * and `.trim()` yields `""`, not `undefined`, so `CODEX_HOME="  "` resolved
 * to `/auth.json` at the filesystem root.
 */

import { describe, expect, it } from "vitest"
import {
  claudeGlobalConfigPath,
  codexAuthPath,
  copilotConfigPath,
  kimiCredentialsPath,
  vendorConfigHome,
} from "../../src/engine/vendor-home.ts"

const deps = (env: Record<string, string> = {}, home = "/home/u") => ({
  env: (k: string) => env[k],
  home: () => home,
})

describe("vendorConfigHome", () => {
  it("defaults to the vendor's dotdir under home", () => {
    expect(vendorConfigHome("claude", deps())).toBe("/home/u/.claude")
    expect(vendorConfigHome("codex", deps())).toBe("/home/u/.codex")
    expect(vendorConfigHome("copilot", deps())).toBe("/home/u/.copilot")
    expect(vendorConfigHome("kimi", deps())).toBe("/home/u/.kimi-code")
  })

  it("honours each vendor's own env override", () => {
    expect(vendorConfigHome("claude", deps({ CLAUDE_CONFIG_DIR: "/profiles/c" }))).toBe("/profiles/c")
    expect(vendorConfigHome("codex", deps({ CODEX_HOME: "/profiles/x" }))).toBe("/profiles/x")
    expect(vendorConfigHome("copilot", deps({ COPILOT_HOME: "/profiles/p" }))).toBe("/profiles/p")
    expect(vendorConfigHome("kimi", deps({ KIMI_CODE_HOME: "/profiles/k" }))).toBe("/profiles/k")
  })

  it("treats a blank override as unset for every vendor, not as the filesystem root", () => {
    expect(vendorConfigHome("codex", deps({ CODEX_HOME: "   " }))).toBe("/home/u/.codex")
    expect(vendorConfigHome("copilot", deps({ COPILOT_HOME: "" }))).toBe("/home/u/.copilot")
    expect(vendorConfigHome("kimi", deps({ KIMI_CODE_HOME: "  " }))).toBe("/home/u/.kimi-code")
    expect(codexAuthPath(() => "  ", "/home/u")).toBe("/home/u/.codex/auth.json")
  })

  it("keeps claude's global-config asymmetry: ~/.claude.json at the home ROOT when unset", () => {
    expect(claudeGlobalConfigPath(() => undefined, "/home/u")).toBe("/home/u/.claude.json")
    expect(claudeGlobalConfigPath((k) => (k === "CLAUDE_CONFIG_DIR" ? "/profiles/c" : undefined), "/home/u")).toBe(
      "/profiles/c/.claude.json",
    )
  })

  it("points each credential reader at the file its CLI actually writes", () => {
    expect(codexAuthPath(() => undefined, "/home/u")).toBe("/home/u/.codex/auth.json")
    expect(copilotConfigPath(() => undefined, "/home/u")).toBe("/home/u/.copilot/config.json")
    expect(kimiCredentialsPath(() => undefined, "/home/u")).toBe("/home/u/.kimi-code/credentials/kimi-code.json")
  })
})
