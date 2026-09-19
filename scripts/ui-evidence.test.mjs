import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPullRequest, validateUiEvidence } from './ui-evidence.mjs'
const files = ['packages/kobe/src/tui-react/panes/sidebar/collapsed-rail.tsx']
const body = `## UI evidence
![Before](https://example.com/before.png)
![After](https://example.com/after.png)
Capture: /harness → xterm.js → PTY → OpenTUI
Viewport: 1280×800
Fixture: isolated four-project rail
Theme: default
## Checks
Passed.`
test('UI bug fixes and refactors cannot bypass screenshots by choosing another template section', () => {
  for (const section of ['Bug fix', 'Refactor', 'Feature']) assert.ok(validateUiEvidence(files, `## ${section}\nTests pass`).length)
})
test('before and after images plus capture provenance pass', () => assert.deepEqual(validateUiEvidence(files, body), []))
test('non-UI changes need no images', () => assert.deepEqual(validateUiEvidence(['docs/API.md'], ''), []))
test('comments, code, local images, duplicate images and missing metadata fail', () => {
  for (const invalid of [`<!--${body}-->`, '```\n' + body + '\n```', body.replaceAll('https://example.com/', '/tmp/'), body.replace('after.png', 'before.png'), body.replace('Theme: default', 'Theme: TODO'), body.replace('/harness', 'Terminal.app'), body.replace('1280×800', 'same')]) {
    assert.ok(validateUiEvidence(files, invalid).length)
  }
})
test('all shipped UI roots are covered', () => {
  for (const root of ['kobe/src/tui', 'kobe/src/tui-react', 'kobe-harness/src']) assert.ok(validateUiEvidence([`packages/${root}/component.tsx`], '').length)
})
test('reads current body and paginated files, including renames out of UI', async () => {
  let failure = ''
  await checkPullRequest({
    github: { rest: { pulls: { get: async () => ({data:{body:''}}), listFiles: 'files' } }, paginate: async () => [{filename:'other.ts', previous_filename:files[0]}] },
    context: { repo:{owner:'owner',repo:'repo'}, payload:{pull_request:{number:1,body}} },
    core: {setFailed: (value) => {failure = value}, info: () => {}}
  })
  assert.match(failure, /UI source changed/)
})
