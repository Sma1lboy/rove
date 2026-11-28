import { expect, test } from "bun:test"
import { expandLinks, token } from "../src/link-badges.tsx"

test("a send swaps each badge, CJK and emoji titles included, back for its URL", () => {
  const links = {
    '虫子 on X: "我的🌟': { url: "https://x.com/a" },
    "github.com/a/b": { url: "https://github.com/a/b" },
  }
  const text = `看${token('虫子 on X: "我的🌟')}和${token("github.com/a/b")}结尾`
  expect(expandLinks(text, links)).toBe("看https://x.com/a和https://github.com/a/b结尾")
})
