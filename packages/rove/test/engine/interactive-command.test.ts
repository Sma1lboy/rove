import { describe, expect, it } from "vitest"
import {
  defaultEngineCommand,
  engineCommandKey,
  engineNameKey,
  parseEngineCommand,
} from "../../src/engine/interactive-command.ts"

describe("parseEngineCommand", () => {
  it("keeps a quoted flag value with spaces as one argv element", () => {
    expect(parseEngineCommand('claude --append-system-prompt "be terse"')).toEqual([
      "claude",
      "--append-system-prompt",
      "be terse",
    ])
    expect(parseEngineCommand("codex --x 'a b c'")).toEqual(["codex", "--x", "a b c"])
  })

  it('keeps a quote attached to a flag (--flag="value with spaces") as one element', () => {
    // The common CLI idiom: a quote opens mid-token and concatenates with the
    // `--flag=` prefix rather than starting a fresh, mis-split argv element.
    expect(parseEngineCommand('claude --append-system-prompt="be terse"')).toEqual([
      "claude",
      "--append-system-prompt=be terse",
    ])
    expect(parseEngineCommand("codex --x='a b c'")).toEqual(["codex", "--x=a b c"])
  })

  it("concatenates adjacent quoted and unquoted spans within one token", () => {
    expect(parseEngineCommand('a"b c"d')).toEqual(["ab cd"])
  })

  it("runs an unterminated quote to the end of the string", () => {
    expect(parseEngineCommand('claude "be terse')).toEqual(["claude", "be terse"])
  })
})

describe("defaultEngineCommand", () => {
  it("runs a custom engine id as a bare binary (not claude)", () => {
    // A custom engine's real command lives in its engineCommand.<id> override;
    // this fallback only fires if that's empty, and must NOT launch claude.
    expect(defaultEngineCommand("aider")).toEqual(["aider"])
  })
})

describe("engineCommandKey", () => {
  it("namespaces the override key per vendor", () => {
    expect(engineCommandKey("claude")).toBe("engineCommand.claude")
    expect(engineCommandKey("codex")).toBe("engineCommand.codex")
  })
})

describe("engineNameKey", () => {
  it("namespaces the display-name key per vendor, parallel to the command key", () => {
    expect(engineNameKey("claude")).toBe("engineName.claude")
    expect(engineNameKey("copilot")).toBe("engineName.copilot")
  })
})
