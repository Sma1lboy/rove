import assert from "node:assert/strict"
import { test } from "node:test"
import { check } from "./web-ui-gate.mjs"

const diff = (file, ...lines) => `+++ b/${file}\n${lines.join("\n")}\n`

test("tailwind.css is the only stylesheet", () => {
  assert.deepEqual(check("", ["packages/rove-web/src/tailwind.css"]), [])
  assert.equal(check("", ["packages/rove-web/src/tailwind.css", "packages/rove-web/src/new.css"]).length, 1)
})

test("tailwind.css takes tokens, reset, xterm and at-rules, not a component's class", () => {
  const sheet = (...l) => check(diff("packages/rove-web/src/tailwind.css", ...l))
  assert.equal(sheet("+.muted {").length, 1)
  assert.deepEqual(sheet("+.term-host .xterm {", "+  --ink: #000;", "+@utility x {", "+  &:hover {", "+  50% {"), [])
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
