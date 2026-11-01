import assert from "node:assert/strict"
import { test } from "node:test"
import { check } from "./web-ui-gate.mjs"

const diff = (file, ...lines) => `+++ b/${file}\n${lines.join("\n")}\n`

test("a sheet may shrink but not grow", () => {
  assert.deepEqual(check(diff("packages/rove-web/src/files.css", "-.a {}", "-.b {}", "+.c {}")), [])
  assert.equal(check(diff("packages/rove-web/src/files.css", "+.c {}")).length, 1)
})

test("moving a raw button is net zero; adding one outside src/ui is not", () => {
  const moved = diff("packages/rove-web/src/x.tsx", '-<button type="button">', '+<button type="button" className="a">')
  assert.deepEqual(check(moved), [])
  assert.equal(check(diff("packages/rove-web/src/x.tsx", '+<button type="button">')).length, 1)
  assert.deepEqual(check(diff("packages/rove-web/src/ui/button.tsx", '+<button type="button">')), [])
  assert.deepEqual(
    check(diff("packages/rove-web/src/x.tsx", '+<button type="button"> {/* ui-ok: native file input */}')),
    [],
  )
})

test("arbitrary values only inside src/ui", () => {
  assert.equal(check(diff("packages/rove-web/src/x.tsx", '+<div className="px-[13px] text-ink">')).length, 1)
  assert.deepEqual(check(diff("packages/rove-web/src/ui/b.tsx", "+  \"touch:after:content-['']\"")), [])
  assert.deepEqual(check(diff("packages/rove-web/src/x.tsx", "+const a = rows[i - 1]")), [])
})

test("a new stylesheet fails; tailwind.css is the theme, not a sheet", () => {
  assert.equal(check("", ["packages/rove-web/src/new.css"]).length, 1)
  assert.deepEqual(check(diff("packages/rove-web/src/tailwind.css", "+@utility x {}")), [])
})

test("a deleted sheet's lines count toward the shrink", () => {
  const gone = "--- a/packages/rove-web/src/old.css\n+++ /dev/null\n-.a {}\n-.b {}\n"
  assert.deepEqual(check(gone + diff("packages/rove-web/src/rail.css", "+.a {}")), [])
})

test("styles.css takes no new class rule, even when another sheet shrinks", () => {
  const shrink = diff("packages/rove-web/src/settings.css", "-.a {}", "-.b {}")
  assert.equal(check(shrink + diff("packages/rove-web/src/styles.css", "+.muted {")).length, 1)
  assert.deepEqual(
    check(shrink + diff("packages/rove-web/src/styles.css", "+.term-host .xterm {", "+  --ink: #000;")),
    [],
  )
})
