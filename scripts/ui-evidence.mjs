/**
 * PR evidence is additive: calling a UI change a bug fix never waives it.
 * The one waiver is explicit and must carry a reason the reviewer can judge —
 * `ui-evidence: none — <reason>` — for UI-source changes that cannot change
 * a frame (a dropped import, a type moved to another module).
 */
export function validateUiEvidence(files, body) {
  const ui = files.some((file) => /^(packages\/kobe\/src\/(tui|tui-react)\/|packages\/kobe-harness\/src\/)/.test(file))
  if (!ui) return []
  const visible = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '')
  const waiver = visible.match(/^ui-evidence:[ \t]*none[ \t]*[—–-][ \t]*(\S[^\n]*)$/im)?.[1]?.trim()
  if (waiver && !/^(TODO|TBD|<|\[|\.\.\.)/i.test(waiver)) return []
  const section = visible.match(/^## UI evidence\s*$([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] ?? ''
  const before = section.match(/!\[Before\]\((https:\/\/[^\s)]+)\)/i)?.[1]
  const after = section.match(/!\[After\]\((https:\/\/[^\s)]+)\)/i)?.[1]
  const errors = []
  if (!before || !after || before === after) {
    errors.push('UI source changed: add distinct ![Before](https://...) and ![After](https://...) screenshots under ## UI evidence, or, when no frame can change, a `ui-evidence: none — <reason>` line. Local paths, comments, and code blocks are not evidence.')
  }
  for (const field of ['Capture', 'Viewport', 'Fixture', 'Theme']) {
    const value = section.match(new RegExp(`^${field}:[ \t]*(\\S[^\\n]*)$`, 'm'))?.[1]?.trim()
    if (!value || /^(TODO|TBD|<|\[|\.\.\.)/i.test(value)) errors.push(`UI evidence needs ${field}: with the actual capture details.`)
    else if (field === 'Capture' && !value.includes('/harness')) errors.push('Capture must name the real /harness → xterm.js → PTY → OpenTUI path.')
    else if (field === 'Viewport' && !/^\d+\s*[x×]\s*\d+\b/.test(value)) errors.push('Viewport must give dimensions, for example 1280×800.')
  }
  return errors
}

export async function checkPullRequest({ github, context, core }) {
  const request = { ...context.repo, pull_number: context.payload.pull_request.number }
  // Read the current body, including on reruns after a description edit.
  const { data: pr } = await github.rest.pulls.get(request)
  const files = await github.paginate(github.rest.pulls.listFiles, { ...request, per_page: 100 })
  const paths = files.flatMap((file) => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])])
  const errors = validateUiEvidence(paths, pr.body)
  if (errors.length) core.setFailed(errors.join('\n'))
  else core.info('UI evidence check passed. Reviewers must still verify the screenshots show the changed state.')
}
