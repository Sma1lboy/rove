import { expect, test } from "bun:test"
import { issueTitle } from "../src/settings-feedback.tsx"

test("a direct issue is titled by its first line with text, cut to a list's width", () => {
  expect(issueTitle("\n  Rail flickers on resize  \nsteps: drag the edge")).toBe("Rail flickers on resize")
  const long = issueTitle("x".repeat(300))
  expect(long.length).toBe(120)
  expect(long.endsWith("…")).toBe(true)
})
