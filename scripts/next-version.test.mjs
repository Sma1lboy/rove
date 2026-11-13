import assert from "node:assert/strict"
import { test } from "node:test"
import { bumpVersion, nextNotes, nextVersion, pendingBump } from "./next-version.mjs"

const cs = (body) => ({ name: "x.md", text: `---\n${body}\n---\n\nsummary\n` })

test("highest bump for the published package wins", () => {
  const files = [cs('"@sma1lboy/rove": patch'), cs('"@sma1lboy/rove": minor'), cs('"@sma1lboy/rove-plugin-sdk": major')]
  assert.equal(pendingBump(files), "minor")
})

test("no changeset for the package falls back to a patch bump", () => {
  assert.equal(nextVersion("0.9.276", [cs('"@sma1lboy/rove-plugin-sdk": major')], 7), "0.9.277-next.7")
  assert.equal(nextVersion("0.9.276", [], 7), "0.9.277-next.7")
})

test("minor and major reset lower fields", () => {
  assert.equal(bumpVersion("0.9.276", "minor"), "0.10.0")
  assert.equal(bumpVersion("0.9.276", "major"), "1.0.0")
})

test("a prerelease base is stripped before bumping", () => {
  assert.equal(bumpVersion("0.9.276-nightly.20261101", "patch"), "0.9.277")
})

test("the Releases-page notes list this package's changes and name the stable version they ship in", () => {
  const notes = nextNotes("0.9.277-next.7", [
    { name: "a.md", text: '---\n"@sma1lboy/rove": patch\n---\n\nFixes the thing.\n' },
    { name: "b.md", text: '---\n"@sma1lboy/rove-plugin-sdk": minor\n---\n\nSDK only.\n' },
  ])
  assert.match(notes, /@sma1lboy\/rove@0\.9\.277-next\.7/)
  assert.match(notes, /stable release 0\.9\.277\./)
  assert.match(notes, /## Changes in this build\n\n- Fixes the thing\.\n/)
  assert.doesNotMatch(notes, /SDK only/)
  assert.match(nextNotes("0.9.277-next.7", []), /No user-facing changes in this build\./)
})

