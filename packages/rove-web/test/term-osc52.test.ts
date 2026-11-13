import { expect, test } from "bun:test"
import { osc52Text } from "../src/term-osc52.ts"

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

test("an OSC 52 write yields its text, non-ASCII included", () => {
  expect(osc52Text(`c;${b64("ssh tinybox — 复制")}`)).toBe("ssh tinybox — 复制")
  expect(osc52Text(`;${b64("no target")}`)).toBe("no target")
})

test.each(["c;?", "c;", "c", "c;not base64!", `c;${btoa("\xff\xfe")}`])(
  "a clipboard read request, an empty write and a broken payload copy nothing: %p",
  (data) => {
    expect(osc52Text(data)).toBeNull()
  },
)
