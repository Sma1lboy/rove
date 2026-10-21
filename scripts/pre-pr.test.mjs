import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingChangeset, packagesToTest, touchedAreas } from './pre-pr.mjs'

const manifests = {
  rove: { name: '@sma1lboy/rove', scripts: { test: 'vitest' } },
  'rove-harness': { name: 'rove-harness', scripts: { test: 'vitest run' } },
  'rove-web': { name: 'rove-web', scripts: { test: 'bun test test' } },
  'rove-landing': { name: '@sma1lboy/rove-landing', scripts: { test: 'node --test' } },
  'rove-daemon': { name: '@sma1lboy/rove-daemon', scripts: {} },
}

test('touched packages with a test script join the always-run ones; dedicated suites are not doubled', () => {
  const files = ['packages/rove-web/src/app.ts', 'packages/rove/src/x.ts', 'packages/rove-harness/src/y.ts', 'packages/rove-daemon/src/z.ts', 'docs/README.md']
  assert.deepEqual(packagesToTest(files, manifests), ['rove-bridge', 'rove-web', 'rove-weixin'])
})

test('a docs-only diff runs only the always-run package tests', () => {
  assert.deepEqual(packagesToTest(['docs/agents/dev-loop.md'], manifests), ['rove-bridge', 'rove-weixin'])
})

test('path-filtered suites follow their workflow paths', () => {
  assert.deepEqual(touchedAreas(['docs/HARNESS.md']), { docs: true, ios: false, pluginWindows: false })
  assert.deepEqual(touchedAreas(['packages/rove-ios/App.swift', 'packages/rove-daemon/src/plugins/mod-host.ts']), { docs: false, ios: true, pluginWindows: true })
  assert.deepEqual(touchedAreas(['packages/rove-daemon/src/client/other.ts']), { docs: false, ios: false, pluginWindows: false })
})

test('published-package source needs an added changeset', () => {
  assert.equal(missingChangeset(['packages/rove-daemon/src/a.ts'], []), true)
  assert.equal(missingChangeset(['packages/rove/src/a.ts'], ['.changeset/README.md']), true)
  assert.equal(missingChangeset(['packages/rove/src/a.ts', '.changeset/x.md'], ['.changeset/x.md']), false)
  assert.equal(missingChangeset(['packages/rove/test/a.test.ts', 'packages/rove-web/src/a.ts'], []), false)
})
