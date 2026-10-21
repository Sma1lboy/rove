import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingChangeset, packagesToTest } from './pre-pr.mjs'

const manifests = {
  rove: { name: '@sma1lboy/rove', scripts: { test: 'vitest' } },
  'rove-harness': { name: 'rove-harness', scripts: { test: 'vitest run' } },
  'rove-web': { name: 'rove-web', scripts: { test: 'bun test test' } },
  'rove-weixin': { name: 'rove-weixin', scripts: { test: 'bun test test' } },
  'rove-daemon': { name: '@sma1lboy/rove-daemon', scripts: {} },
}

test('only touched packages with a test script run; CI-only suites are skipped, not run', () => {
  const files = ['packages/rove-web/src/app.ts', 'packages/rove-web/test/a.test.ts', 'packages/rove/src/x.ts', 'packages/rove-harness/src/y.ts', 'packages/rove-daemon/src/z.ts', 'docs/README.md']
  assert.deepEqual(packagesToTest(files, manifests), { run: ['rove-web'], skipped: ['@sma1lboy/rove', 'rove-harness'] })
})

test('a docs-only diff runs no package tests', () => {
  assert.deepEqual(packagesToTest(['docs/agents/dev-loop.md', 'AGENTS.md'], manifests), { run: [], skipped: [] })
})

test('published-package source needs an added changeset, as in ci.yml changeset-cap', () => {
  assert.equal(missingChangeset(['packages/rove-daemon/src/a.ts'], []), true)
  assert.equal(missingChangeset(['packages/rove/src/a.ts'], ['.changeset/README.md']), true)
  assert.equal(missingChangeset(['packages/rove/src/a.ts', '.changeset/x.md'], ['.changeset/x.md']), false)
  assert.equal(missingChangeset(['packages/rove/test/a.test.ts', 'packages/rove-web/src/a.ts'], []), false)
})
