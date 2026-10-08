#!/usr/bin/env node
/**
 * Regenerate docs/PLUGIN-DIRECTORY.md from the public GitHub topic
 * `rove-plugin` — the same topic the marketplace reads (rove.run/plugins,
 * `rove plugin search`, Settings → Marketplace).
 *
 * Determinism is the contract. The same topic listing and the same manifests
 * must render byte-identical output, so a re-run writes nothing and a routine
 * built on it opens no PR on a quiet day. That rules out every field that
 * drifts on its own — stars, push dates, a scan timestamp — and leaves only
 * what changes when a plugin actually changes.
 *
 *   node scripts/scan-plugins.mjs           # write the page
 *   node scripts/scan-plugins.mjs --check    # exit 0 iff the page would change
 *
 * `--check` is the scheduled routine's precheck: exit 0 means "there is work",
 * non-zero skips the firing without spawning an agent. A network failure
 * throws in both modes, so a flaky GitHub can never be mistaken for "no new
 * plugins" and silently rewrite the page from half a listing.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse } from "smol-toml"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const OUT_PATH = join(repoRoot, "docs", "PLUGIN-DIRECTORY.md")

const TOPIC = "rove-plugin"
const MANIFEST_NAME = "rove-plugin.toml"
const SEARCH_LIMIT = 100

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ""

function apiHeaders() {
  const headers = { accept: "application/vnd.github+json", "user-agent": "rove-plugin-directory" }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

/** Repos tagged with the topic, sorted by full name. Throws when the search fails. */
export async function fetchTopicRepos(fetchImpl = fetch) {
  const url = `https://api.github.com/search/repositories?q=topic:${TOPIC}&per_page=${SEARCH_LIMIT}`
  const res = await fetchImpl(url, { headers: apiHeaders() })
  if (!res.ok) throw new Error(`GitHub topic search failed: HTTP ${res.status}`)
  const body = await res.json()
  if (!Array.isArray(body.items)) throw new Error("GitHub topic search returned no items array")
  if (body.incomplete_results !== false) throw new Error("GitHub topic search returned incomplete results")
  if (!Number.isSafeInteger(body.total_count) || body.total_count < 0) {
    throw new Error("GitHub topic search returned an invalid total count")
  }
  if (body.total_count > SEARCH_LIMIT) {
    throw new Error(`GitHub topic search exceeds the ${SEARCH_LIMIT}-repository limit; pagination is required`)
  }
  if (body.items.length !== body.total_count) throw new Error("GitHub topic search result count does not match total")
  if (body.items.some((repo) => typeof repo?.full_name !== "string" || !repo.full_name)) {
    throw new Error("GitHub topic search returned a repository without a full name")
  }
  return body.items
    .map((repo) => ({
      fullName: repo.full_name,
      url: typeof repo.html_url === "string" ? repo.html_url : `https://github.com/${repo.full_name}`,
      description: typeof repo.description === "string" ? repo.description : "",
    }))
    .sort((a, b) => a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()))
}

/**
 * The manifest's top-level scalar strings, or null when the repo has no
 * manifest at its root. Parse the whole document to handle multiline strings;
 * nested plugin tables are excluded from the directory metadata.
 *
 * A 404 is "this repo has no manifest"; any other failure throws, because
 * rendering a manifest-less row for a repo that has one is exactly the
 * phantom diff the determinism contract forbids.
 */
export async function fetchManifest(fullName, fetchImpl = fetch) {
  const url = `https://raw.githubusercontent.com/${fullName}/HEAD/${MANIFEST_NAME}`
  const res = await fetchImpl(url, { headers: { "user-agent": "rove-plugin-directory" } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`manifest fetch failed for ${fullName}: HTTP ${res.status}`)
  return readManifestHeader(await res.text())
}

/** Top-level scalar strings, parsed with the plugin loader's TOML parser. */
export function readManifestHeader(text) {
  return Object.fromEntries(Object.entries(parse(text)).filter(([, value]) => typeof value === "string"))
}

/**
 * One table cell. The page is MDX, so a description is not inert text: a
 * stray `|` breaks the table, `<name>` parses as a JSX tag, `{` starts an
 * expression, and a backtick opens inline code. Escape all four, `&` first so
 * the entities this adds are not themselves escaped.
 */
function cell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[{}`]/g, (char) => ({ "{": "&#123;", "}": "&#125;", "`": "&#96;" })[char])
    .replace(/\s+/g, " ")
    .trim()
}

function pluginLabel(entry) {
  const manifest = entry.manifest
  const name = manifest?.name?.trim()
  const id = manifest?.id?.trim()
  if (name && id && name !== id) return `${cell(name)} (\`${cell(id)}\`)`
  return cell(name || id || entry.fullName.split("/").pop())
}

/**
 * The page. Pure: no clock, no network, no ambient state — the whole reason
 * the scan can be re-run for free.
 */
export function renderPage(plugins) {
  const rows = plugins.map((entry) => {
    const manifest = entry.manifest
    const version = manifest?.version?.trim()
    const description = manifest?.description?.trim() || entry.description.trim()
    return [
      pluginLabel(entry),
      cell(version) || "—",
      `[${cell(entry.fullName)}](${entry.url})`,
      cell(description) || "—",
    ]
  })
  const table = rows.map((row) => `| ${row.join(" | ")} |`).join("\n")
  return [
    "# Plugin directory",
    "",
    "Every public GitHub repository carrying the",
    `[\`${TOPIC}\`](https://github.com/topics/${TOPIC}) topic, with the version its`,
    `\`${MANIFEST_NAME}\` declares. Install one with \`rove plugin install owner/repo\`;`,
    "the same topic drives the in-TUI marketplace and [rove.run/plugins](https://rove.run/plugins).",
    "",
    "Generated by `scripts/scan-plugins.mjs` — edit the script, not this page.",
    "",
    "| Plugin | Version | Repository | Description |",
    "| --- | --- | --- | --- |",
    table,
    "",
  ].join("\n")
}

function readCurrentPage(outPath) {
  try {
    return readFileSync(outPath, "utf8")
  } catch {
    return null
  }
}

/** Resolve every topic repo to a page row input. */
export async function collectPlugins(fetchImpl = fetch) {
  const repos = await fetchTopicRepos(fetchImpl)
  const plugins = []
  for (const repo of repos) {
    plugins.push({ ...repo, manifest: await fetchManifest(repo.fullName, fetchImpl) })
  }
  return plugins
}

/**
 * Scan, render, and write only when the page actually changed. Returns what
 * happened so the caller owns the exit code and a test can assert the no-op
 * without reaching into the filesystem.
 */
export async function run({ check = false, fetchImpl = fetch, outPath = OUT_PATH, log = console.log } = {}) {
  const plugins = await collectPlugins(fetchImpl)
  const next = renderPage(plugins)
  const label = `${plugins.length} plugin ${plugins.length === 1 ? "repository" : "repositories"}`
  const where = relative(repoRoot, outPath)

  if (next === readCurrentPage(outPath)) {
    log(`${where} is already current (${label})`)
    return { changed: false, wrote: false }
  }
  if (check) {
    log(`${where} would change (${label})`)
    return { changed: true, wrote: false }
  }
  writeFileSync(outPath, next)
  log(`wrote ${where} (${label})`)
  return { changed: true, wrote: true }
}

async function main(argv) {
  const check = argv.includes("--check")
  // `--check` is a precheck: exit 0 means "there is work", anything else skips
  // the firing. So a current page must NOT exit 0 here.
  const { changed } = await run({ check })
  if (check && !changed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`scan-plugins: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 2
  })
}
