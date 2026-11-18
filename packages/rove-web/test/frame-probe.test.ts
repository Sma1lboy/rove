import { expect, test } from "bun:test"
import { ProbeAnswers } from "../src/use-frame-probe.ts"

const PAGE = "https://example.com/page"
const OK = { reachable: true, frameable: true }

test("an answer older than a minute is asked again and still stands, so the page on screen stays", () => {
  const answers = new ProbeAnswers()
  answers.set(PAGE, OK, 0)
  expect(answers.due(PAGE, 59_000)).toBe(false)
  expect(answers.due(PAGE, 61_000)).toBe(true)
  expect(answers.get(PAGE)?.probe).toEqual(OK)
})

test("a lost connection on the second ask keeps what the site said the first time", () => {
  const answers = new ProbeAnswers()
  const refuses = { reachable: true, frameable: false, reason: "x-frame-options" }
  answers.set(PAGE, refuses, 0)
  answers.set(PAGE, null, 61_000)
  expect(answers.get(PAGE)?.probe).toEqual(refuses)
})
