import { describe, expect, test } from "vitest"
import { quoteShellArg, quoteShellArgv } from "../../src/lib/shell-command"

describe("shell-command quoting", () => {
  test("can pass simple tokens through bare when requested", () => {
    expect(quoteShellArgv(["claude", "--model", "sonnet"], { bareSafe: true })).toBe("claude --model sonnet")
    expect(quoteShellArgv(["a b", "x;y", "$(whoami)"], { bareSafe: true })).toBe("'a b' 'x;y' '$(whoami)'")
  })

  test("quotes for a Windows shell with double quotes, MSVCRT style", () => {
    const win = { bareSafe: true, windows: true }
    expect(quoteShellArgv(["kobe", "hook", "turn-complete", "--engine", "codex"], win)).toBe(
      "kobe hook turn-complete --engine codex",
    )
    expect(quoteShellArgv(["C:\\Program Files\\rove\\rove.exe", "hook"], win)).toBe(
      '"C:\\Program Files\\rove\\rove.exe" hook',
    )
    expect(quoteShellArg('say "hi"', { windows: true })).toBe('"say \\"hi\\""')
    expect(quoteShellArg("C:\\dir\\", { windows: true })).toBe('"C:\\dir\\\\"')
  })
})
