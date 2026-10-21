import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingChangeset, packagesToTest, touchedAreas } from './pre-pr.mjs'
import { pickDistro, toWslPath, wslScript } from './pre-pr-wsl.mjs'

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

test('Windows hands the POSIX suites to a real WSL distro, never Docker Desktop', () => {
  const list = Buffer.from('docker-desktop\r\nUbuntu-24.04\r\n', 'utf16le').toString('utf16le')
  assert.equal(pickDistro(list), 'Ubuntu-24.04')
  assert.equal(pickDistro('docker-desktop\r\n'), null)
  assert.equal(pickDistro(list, 'Debian'), 'Debian')
  assert.equal(toWslPath('C:\\Users\\me\\rove\\.git'), '/mnt/c/Users/me/rove/.git')
  assert.equal(toWslPath('D:/work/'), '/mnt/d/work')
})

test('the WSL script survives wsl.exe argv re-quoting', () => {
  const script = wslScript({ name: 'wt', gitDir: 'C:/r/.git', ref: 'refs/pre-pr/wt', touchedFile: 'C:\\T\\touched.txt', jobs: 4 })
  assert.ok(!script.includes('"') && !script.includes('\n'))
  assert.match(script, /--touched-file \/mnt\/c\/T\/touched\.txt --jobs 4$/)
  assert.match(wslScript({ name: 'wt', gitDir: 'C:/r/.git', ref: 'r', touchedFile: 'C:/t', jobs: 2, full: true }), /--jobs 2 --full$/)
})
