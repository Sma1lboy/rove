import { expect, test } from "bun:test"
import { createCopyHold } from "../src/term-copy.ts"

test("an engine's copy on mouse release waits for the copy chord; one after a key is written at once", () => {
  const copied: string[] = []
  let at = 0
  const hold = createCopyHold(
    (text) => void copied.push(text),
    () => at,
  )

  hold.press()
  hold.release()
  at += 20
  hold.osc52("selected")
  expect(copied).toEqual([])
  expect(hold.text()).toBe("selected")

  hold.key()
  hold.osc52("asked for")
  expect(copied).toEqual(["asked for"])

  hold.press()
  expect(hold.text()).toBe("")
})
