import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { collectPlugins, fetchManifest, fetchTopicRepos, readManifestHeader, renderPage, run } from "./scan-plugins.mjs"

const DEMO_MANIFEST = `# A pane plugin.
id = "demo-engine"
name = "Claude Code demo tab"
version = "0.1.0"
min_rove_version = "0.9.239"
description = "An opt-in tab that replays a scripted session."

[[panes]]
id = "claude-code"
title = "Claude Code (demo)"
`

/** Raw GitHub search shapes — what fetchTopicRepos maps, not what it returns. */
const demoRepo = {
  full_name: "wisp-agent-ai/rove-plugin-demo-engine",
  html_url: "https://github.com/wisp-agent-ai/rove-plugin-demo-engine",
  description: "Repo description, ignored when the manifest carries one.",
}
const collectionRepo = {
  full_name: "Sma1lboy/rove-plugins",
  html_url: "https://github.com/Sma1lboy/rove-plugins",
  description: "Official plugins — install with: rove plugin install <name>",
}
const DEMO = demoRepo.full_name
const COLLECTION = collectionRepo.full_name

/** The row input renderPage takes, the way fetchTopicRepos+fetchManifest build it. */
const resolved = (repo, manifest) => ({
  fullName: repo.full_name,
  url: repo.html_url,
  description: repo.description,
  manifest,
})

/** A fetch stub serving the search endpoint and raw manifests, like GitHub. */
function stubFetch({ items, manifests = {}, incomplete_results = false, total_count = items.length }) {
  return async (url) => {
    if (url.startsWith("https://api.github.com/search/repositories")) {
      return { ok: true, status: 200, json: async () => ({ items, incomplete_results, total_count }) }
    }
    const match = /raw\.githubusercontent\.com\/(.+)\/HEAD\/rove-plugin\.toml$/.exec(url)
    const body = match && manifests[match[1]]
    return body === undefined
      ? { ok: false, status: 404, text: async () => "" }
      : { ok: true, status: 200, text: async () => body }
  }
}

test("the same topic listing renders byte-identical output, whatever order it arrives in", async () => {
  const manifests = { [DEMO]: DEMO_MANIFEST }
  const forward = await collectPlugins(stubFetch({ items: [collectionRepo, demoRepo], manifests }))
  const reversed = await collectPlugins(stubFetch({ items: [demoRepo, collectionRepo], manifests }))
  assert.equal(renderPage(forward), renderPage(reversed))
  assert.deepEqual(
    forward.map((plugin) => plugin.fullName),
    [COLLECTION, DEMO],
  )
})

test("a repo with no root manifest falls back to its own name and description", () => {
  const page = renderPage([resolved(collectionRepo, null)])
  assert.match(page, /^\| rove-plugins \| — \|/m)
  assert.match(page, /Official plugins — install with: rove plugin install &lt;name&gt;/)
})

test("the manifest supplies the name, version and description when it has them", () => {
  const page = renderPage([resolved(demoRepo, readManifestHeader(DEMO_MANIFEST))])
  assert.match(page, /^\| Claude Code demo tab \(`demo-engine`\) \| 0\.1\.0 \|/m)
  assert.match(page, /An opt-in tab that replays a scripted session\./)
  assert.doesNotMatch(page, /Repo description, ignored/)
})

test("description text cannot break the MDX page it lands in", () => {
  const hostile = resolved(demoRepo, {
    name: "Evil",
    id: "evil",
    version: "1.0.0",
    description: "a | b <Tag> {expr} `code` & more",
  })
  const page = renderPage([hostile])
  const row = page.split("\n").find((line) => line.startsWith("| Evil"))
  assert.ok(row, "the row renders")
  assert.equal(row.split(" | ").length, 4, "the description stays in one cell")
  for (const raw of ["<Tag>", "{expr}", "`code`"]) assert.ok(!row.includes(raw), `${raw} must be escaped`)
  assert.match(row, /&lt;Tag&gt;/)
  assert.match(row, /&#123;expr&#125;/)
  assert.match(row, /&#96;code&#96;/)
})

test("only top-level strings become directory metadata", () => {
  const fields = readManifestHeader(DEMO_MANIFEST)
  assert.deepEqual(Object.keys(fields).sort(), ["description", "id", "min_rove_version", "name", "version"])
  assert.equal(fields.description, "An opt-in tab that replays a scripted session.")
})

test("a manifest 404 is 'no manifest'; any other failure throws rather than dropping fields", async () => {
  assert.equal(await fetchManifest("owner/absent", stubFetch({ items: [] })), null)
  const flaky = async () => ({ ok: false, status: 503, text: async () => "" })
  await assert.rejects(() => fetchManifest("owner/repo", flaky), /HTTP 503/)
})

test("a current page is not rewritten, and --check says there is nothing to do", async () => {
  const outPath = join(mkdtempSync(join(tmpdir(), "rove-plugins-")), "PLUGIN-DIRECTORY.md")
  const fetchImpl = stubFetch({ items: [collectionRepo, demoRepo], manifests: { [DEMO]: DEMO_MANIFEST } })
  const quiet = () => {}

  assert.deepEqual(await run({ fetchImpl, outPath, log: quiet }), { changed: true, wrote: true })
  const written = readFileSync(outPath, "utf8")

  assert.deepEqual(await run({ fetchImpl, outPath, log: quiet }), { changed: false, wrote: false })
  assert.equal(readFileSync(outPath, "utf8"), written, "a quiet re-run leaves the file byte-identical")
  assert.deepEqual(await run({ check: true, fetchImpl, outPath, log: quiet }), { changed: false, wrote: false })
})

test("--check reports work when a new plugin appears, and writes nothing", async () => {
  const outPath = join(mkdtempSync(join(tmpdir(), "rove-plugins-")), "PLUGIN-DIRECTORY.md")
  const quiet = () => {}
  const manifests = { [DEMO]: DEMO_MANIFEST }

  await run({ fetchImpl: stubFetch({ items: [demoRepo], manifests }), outPath, log: quiet })
  const withOne = readFileSync(outPath, "utf8")

  const grown = stubFetch({ items: [demoRepo, collectionRepo], manifests })
  assert.deepEqual(await run({ check: true, fetchImpl: grown, outPath, log: quiet }), { changed: true, wrote: false })
  assert.equal(readFileSync(outPath, "utf8"), withOne, "the precheck never touches the page")
})

for (const [label, response, error] of [
  ["incomplete results", { items: [demoRepo], incomplete_results: true, total_count: 2 }, /incomplete/],
  [
    "more than 100 repositories",
    {
      items: Array.from({ length: 100 }, (_, i) => ({ full_name: `owner/plugin${i}` })),
      total_count: 101,
    },
    /100.*limit/,
  ],
  ["a truncated listing", { items: [demoRepo], total_count: 2 }, /count/],
]) {
  test(`${label} fails without changing the existing directory`, async () => {
    const outPath = join(mkdtempSync(join(tmpdir(), "rove-plugins-")), "PLUGIN-DIRECTORY.md")
    const log = () => {}
    await run({ fetchImpl: stubFetch({ items: [demoRepo, collectionRepo] }), outPath, log })
    const before = readFileSync(outPath, "utf8")
    for (const check of [false, true]) {
      await assert.rejects(run({ fetchImpl: stubFetch(response), outPath, log, check }), error)
      assert.equal(readFileSync(outPath, "utf8"), before)
    }
  })
}

test("TOML literal, Unicode and multiline strings reach the rendered directory intact", async () => {
  const manifest = String.raw`id = 'demo'
version = '1.2.3'
name = "caf\u00e9 \U0001F680"
description = """
First line
[still description] \"quoted\"
"""
license = '''
Literal \path
second line
'''
[metadata]
name = "not the plugin name"
`
  const fields = await fetchManifest(DEMO, stubFetch({ items: [demoRepo], manifests: { [DEMO]: manifest } }))
  assert.equal(fields.version, "1.2.3")
  assert.equal(fields.name, "café 🚀")
  assert.equal(fields.description, 'First line\n[still description] "quoted"\n')
  assert.equal(fields.license, "Literal \\path\nsecond line\n")
  assert.equal(fields.metadata, undefined)
  const page = renderPage([resolved(demoRepo, fields)])
  assert.match(page, /café 🚀 .* \| 1\.2\.3 \|/)
  assert.match(page, /First line \[still description\] "quoted"/)
})

test("complete listings at the supported boundaries are accepted", async () => {
  for (const count of [0, 100]) {
    const items = Array.from({ length: count }, (_, i) => ({ full_name: `owner/plugin${i}` }))
    assert.equal((await fetchTopicRepos(stubFetch({ items }))).length, count)
  }
})

test("invalid TOML aborts the scan without changing the existing directory", async () => {
  const outPath = join(mkdtempSync(join(tmpdir(), "rove-plugins-")), "PLUGIN-DIRECTORY.md")
  const log = () => {}
  await run({ fetchImpl: stubFetch({ items: [demoRepo] }), outPath, log })
  const before = readFileSync(outPath, "utf8")
  const fetchImpl = stubFetch({ items: [demoRepo], manifests: { [DEMO]: 'name = "unterminated' } })
  await assert.rejects(run({ fetchImpl, outPath, log }), /TOML/)
  assert.equal(readFileSync(outPath, "utf8"), before)
})
