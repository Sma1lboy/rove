import { expect, test } from "bun:test"
import { backFrom, initialView } from "../src/settings-sections.ts"

test("a deep link lands on its section; opening bare starts at the first and shows the phone's list", () => {
  expect(initialView("engines")).toEqual({ section: "engines", drilled: true })
  expect(initialView()).toEqual({ section: "general", drilled: false })
})

test("back from a phone's open section goes to the list; from the list or any desktop view it closes", () => {
  expect(backFrom({ section: "engines", drilled: true }, true)).toBe("list")
  expect(backFrom({ section: "engines", drilled: false }, true)).toBe("close")
  expect(backFrom({ section: "engines", drilled: true }, false)).toBe("close")
})
