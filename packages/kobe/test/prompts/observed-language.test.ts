/**
 * Language detection for injected prompts.
 *
 * The contract is narrow on purpose: CJK or not, from the user's own text.
 * These pin the cases that decide whether the coarse rule is good enough —
 * mixed prose (a Chinese sentence full of identifiers and CLI flags is
 * still Chinese; an English sentence quoting one Chinese word is still
 * English) and the no-opinion cases that must not overwrite a real
 * observation.
 */

import { detectLanguage } from "@sma1lboy/kobe-daemon/prompts/observed-language"
import { describe, expect, test } from "vitest"

describe("detectLanguage", () => {
  test("plain prose in either language", () => {
    expect(detectLanguage("帮我重构登录模块")).toBe("zh")
    expect(detectLanguage("Refactor the login module")).toBe("en")
  })

  test("Chinese prose stays Chinese through identifiers, paths and flags", () => {
    // The realistic shape of a Rove prompt: prose plus the code it is about.
    // Counting CJK presence alone would be fine here, but so would a share
    // rule — this pins that the code does not outvote the prose.
    expect(detectLanguage("修一下 auth.login 的 bug，跑 bun run test:fast 验证")).toBe("zh")
    expect(detectLanguage("帮我看下这段:\n```\nconst x = doSomething(withAVeryLongName)\n```\n哪里错了")).toBe("zh")
  })

  test("English prose quoting a CJK term is still English", () => {
    // This is the case a presence check gets wrong, and the reason the rule
    // compares shares instead.
    expect(detectLanguage("The variable 名前 is misnamed")).toBe("en")
  })

  test("kana lands on the non-English side", () => {
    // `zh` is the closest locale we ship; reading Japanese as English would
    // be the worse wrong answer.
    expect(detectLanguage("ログインモジュールをリファクタして")).toBe("zh")
  })

  test("text with no letters at all carries no opinion", () => {
    // null means "learned nothing", so a caller keeps its earlier
    // observation instead of overwriting it with a shrug.
    expect(detectLanguage("")).toBeNull()
    expect(detectLanguage("   \n\t ")).toBeNull()
    expect(detectLanguage("12345 —— 6789 ...")).toBeNull()
  })

  test("a bare path is English, not no-opinion", () => {
    // Latin letters are letters: this is a real signal, just a weak one.
    expect(detectLanguage("/path/to/x.ts --flag")).toBe("en")
  })
})
