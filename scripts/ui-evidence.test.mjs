import assert from "node:assert/strict"
import { test } from "node:test"
import { checkPullRequest, validateUiEvidence } from "./ui-evidence.mjs"
const files = ["packages/rove/src/tui-react/panes/sidebar/collapsed-rail.tsx"]
const body = `## UI evidence
![Before](https://example.com/before.png)
![After](https://example.com/after.png)
Capture: /harness → xterm.js → PTY → OpenTUI
Viewport: 1280×800
Fixture: isolated four-project rail
Theme: default
## Checks
Passed.`
for (const section of ["Bug fix", "Refactor", "Feature"]) {
  test(`a UI change under "${section}" cannot bypass screenshots`, () =>
    assert.ok(validateUiEvidence(files, `## ${section}\nTests pass`).length))
}
test("before and after images plus capture provenance pass", () =>
  assert.deepEqual(validateUiEvidence(files, body), []))
test("an explicit waiver with a reason passes", () => {
  assert.deepEqual(validateUiEvidence(files, "## Refactor\nui-evidence: none — only unused imports removed"), [])
})
for (const invalid of [
  "ui-evidence: none",
  "ui-evidence: none — <reason>",
  "ui-evidence: none — TODO",
  "<!-- ui-evidence: none — hidden -->",
  "```\nui-evidence: none — in code\n```",
]) {
  test(`an empty, placeholder or hidden waiver fails: ${JSON.stringify(invalid)}`, () =>
    assert.ok(validateUiEvidence(files, invalid).length))
}
test("non-UI changes need no images", () => assert.deepEqual(validateUiEvidence(["docs/API.md"], ""), []))
for (const [label, invalid] of [
  ["commented out", `<!--${body}-->`],
  ["in a code block", `\`\`\`\n${body}\n\`\`\``],
  ["local images", body.replaceAll("https://example.com/", "/tmp/")],
  ["duplicate images", body.replace("after.png", "before.png")],
  ["placeholder theme", body.replace("Theme: default", "Theme: TODO")],
  ["wrong capture path", body.replace("/harness", "Terminal.app")],
  ["no viewport", body.replace("1280×800", "same")],
]) {
  test(`evidence fails when ${label}`, () => assert.ok(validateUiEvidence(files, invalid).length))
}
for (const root of ["rove/src/tui", "rove/src/tui-react", "rove-harness/src"]) {
  test(`UI root ${root} is covered`, () => assert.ok(validateUiEvidence([`packages/${root}/component.tsx`], "").length))
}
test("reads current body and paginated files, including renames out of UI", async () => {
  let failure = ""
  await checkPullRequest({
    github: {
      rest: { pulls: { get: async () => ({ data: { body: "" } }), listFiles: "files" } },
      paginate: async () => [{ filename: "other.ts", previous_filename: files[0] }],
    },
    context: { repo: { owner: "owner", repo: "repo" }, payload: { pull_request: { number: 1, body } } },
    core: {
      setFailed: (value) => {
        failure = value
      },
      info: () => {},
    },
  })
  assert.match(failure, /UI source changed/)
})
