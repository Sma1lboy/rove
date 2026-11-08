import { expect, test } from "bun:test"
import { afterTake } from "../src/voice/learn.ts"

const take = (before: string, at: number, end: number, spoken: string) => {
  const glue = at > 0 && !/\s$/.test(before.slice(0, at)) ? " " : ""
  const next = `${before.slice(0, at)}${glue}${spoken}${before.slice(end)}`
  return { next, span: [at + glue.length, at + glue.length + spoken.length] as const }
}

test("a take inserted before an earlier one shifts it, and both still point at what was heard", () => {
  const first = take("", 0, 0, "把 Jithub 改一下")
  let heard = afterTake(null, "", first.next, 0, 0, first.span)
  const second = take(first.next, 0, 0, "Cavin 说")
  heard = afterTake(heard, first.next, second.next, 0, 0, second.span)
  expect(heard.spans.map(([s, e]) => heard.base.slice(s, e)).sort()).toEqual(["Cavin 说", "把 Jithub 改一下"])
})

test("typing between takes starts the record over: the old spans no longer point at what was heard", () => {
  const first = take("", 0, 0, "Jithub")
  const heard = afterTake(null, "", first.next, 0, 0, first.span)
  const typed = `fix ${first.next}`
  const second = take(typed, typed.length, typed.length, "Cavin")
  const after = afterTake(heard, typed, second.next, typed.length, typed.length, second.span)
  expect(after.spans.map(([s, e]) => after.base.slice(s, e))).toEqual(["Cavin"])
})

test("a take dictated over a selection drops the earlier take it replaced", () => {
  const first = take("", 0, 0, "Jithub")
  const heard = afterTake(null, "", first.next, 0, 0, first.span)
  const second = take(first.next, 0, first.next.length, "GitHub Actions")
  const after = afterTake(heard, first.next, second.next, 0, first.next.length, second.span)
  expect(after.spans.map(([s, e]) => after.base.slice(s, e))).toEqual(["GitHub Actions"])
})
