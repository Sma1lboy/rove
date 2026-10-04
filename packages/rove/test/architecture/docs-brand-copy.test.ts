/**
 * Rename guard for CURRENT documentation, landing copy, active agent skills,
 * and the generated docs illustrations.
 *
 * `package-distribution.test.ts` pins the npm/repository contract and
 * `active-product-copy.test.ts` pins stale-architecture claims. Neither sees
 * the third failure mode of the Rove -> Rove rename: a page that still tells a
 * user to run `rove …`, or prints a state path / branch prefix Rove does not
 * write. Those are silent because they are only wrong for NEW users.
 *
 * NEGATIVE assertions only, same rule as `active-product-copy.test.ts`: assert
 * the absence of the stale spelling, never the presence of an exact sentence.
 *
 * Deliberately NOT covered here, because they are preserved compatibility:
 * the `rove` executable and `@sma1lboy/rove` package, `ROVE_*` env aliases,
 * `packages/rove*` workspace names, `~/.rove` runtime + plugin paths, legacy
 * `.rove/worktrees` discovery, the `rove-plugin` topic,
 * the installed `.agents/skills/rove/SKILL.md` path,
 * and the persisted `rove hook` invocation.
 * `[ROVE PEER]`/`[ROVE FIELD NOTE]` are deliberately NOT compatibility: the
 * message prefixes are read by LLMs, not parsed by code, so `[ROVE PEER]`/
 * `[ROVE FIELD NOTE]` need no compat shim — guarded below.
 * Historical records (`docs/adr/`, `docs/superpowers/`, CHANGELOG, and the
 * superseded design notes) keep their original wording on purpose.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/** Design notes that document CURRENT behavior, so their commands must run. */
const CURRENT_DESIGN_DOCS = [
  "docs/design/automations.md",
  "docs/design/dispatcher.md",
  "docs/design/engine-internals.md",
  "docs/design/herdr-gap-analysis.md",
  "docs/design/keybinding-decisions.md",
  "docs/design/plugins.md",
  "docs/design/remote-projects.md",
  "docs/design/remote-topology-status.md",
  "docs/design/tasks.md",
  "docs/design/work-items.md",
]

/**
 * A `rove <verb>` the reader is expected to TYPE. `rove hook` is excluded: it
 * is persisted into engine config files by `roveHookInvocation()` and must
 * keep the guaranteed legacy name.
 */
const TYPED_ROVE_COMMAND =
  /\brove (?!hook\b)(api|attach|daemon|doctor|reset|update|plugin|skill|theme|repo|config|web|add|remove|list|feedback|export|completions|pty-host)\b/

/**
 * The product called `rove` rather than `rove`. Compatibility spellings survive the
 * lookahead: `packages/rove-docs`, `rove-plugin`, `.agents/skills/rove/`, and
 * `packages/rove/src/…` all continue with `-`, `/`,
 * or `.`, so only a bare "rove"/"Rove"/"rove's" — the product itself — trips.
 */
const PRODUCT_NAME_ROVE = /\brove(?:['’]s)?\b(?![-/.])/i

/** Product-data paths that moved to the Rove layout. */
const MOVED_STATE_PATHS = ["~/.rove/tasks.json", "~/.rove/settings/", "~/.rove/themes/", "~/.config/rove/state.json"]

describe("current docs and landing copy speak Rove", () => {
  test.each(CURRENT_DESIGN_DOCS)("%s tells the reader to run rove", (path) => {
    const match = TYPED_ROVE_COMMAND.exec(read(path))
    expect(match?.[0], `${path} still documents "${match?.[0]}"`).toBeUndefined()
  })

  test.each(["CONTEXT.md", "docs/CLI.md", "docs/CONFIGURATION.md", "docs/KEYBINDINGS.md", "docs/themes.md"])(
    "%s prints canonical Rove state paths",
    (path) => {
      const source = read(path)
      for (const stale of MOVED_STATE_PATHS) {
        expect(source, `${path} still points at ${stale}`).not.toContain(stale)
      }
    },
  )

  test("the CLI environment table leads with the canonical names", () => {
    const source = read("docs/CLI.md")
    const table = source.slice(source.indexOf("## Environment variables"))
    // A `| \`ROVE_…\` |` first cell means the alias is being taught as the
    // primary spelling; prose mentions of the aliases stay welcome.
    expect(table, "docs/CLI.md documents a ROVE_* alias as the primary name").not.toMatch(/^\|\s*`ROVE_/m)
  })

  test("docs and issue templates use the canonical repository and CLI", () => {
    expect(read("docs/TUI.md"), "docs/TUI.md links the redirected repository").not.toMatch(
      /github\.com\/Sma1lboy\/rove\//i,
    )

    const bugReport = read(".github/ISSUE_TEMPLATE/bug_report.md")
    expect(bugReport, "the bug template still asks for `rove` diagnostics").not.toMatch(TYPED_ROVE_COMMAND)
    expect(bugReport, "the bug template still asks for `rove --version`").not.toContain("rove --version")

    const engineRequest = read(".github/ISSUE_TEMPLATE/engine-support-request.md")
    expect(engineRequest, "the engine template still calls the product Rove").not.toContain("Rove")
  })

  test.each(["docs/design/herdr-gap-analysis.md", ".claude/skills/file-issue/SKILL.md"])(
    "%s calls the product Rove",
    (path) => {
      const match = PRODUCT_NAME_ROVE.exec(read(path))
      expect(match?.[0], `${path} still calls the product "${match?.[0]}"`).toBeUndefined()
    },
  )

  test("the active file-issue skill teaches rove commands", () => {
    const source = read(".claude/skills/file-issue/SKILL.md")
    const match = TYPED_ROVE_COMMAND.exec(source)
    expect(match?.[0], `the file-issue skill still teaches "${match?.[0]}"`).toBeUndefined()
  })

  // The peer/field-note prefixes are LLM-read text: no code parses the
  // literal, so there is no compat shim to preserve. Producers and the skill
  // must not regrow the `ROVE` spelling.
  test.each([
    "packages/rove/src/cli/api/handlers-tasks.ts",
    "packages/rove-daemon/src/daemon/handlers-ui.ts",
    "packages/rove/src/engine/interactive-command.ts",
    ".agents/skills/rove/SKILL.md",
  ])("%s stamps ROVE-branded message provenance", (path) => {
    const source = read(path)
    expect(source, `${path} still stamps [ROVE PEER]`).not.toContain("[ROVE PEER]")
    expect(source, `${path} still stamps [ROVE FIELD NOTE]`).not.toContain("[ROVE FIELD NOTE]")
  })

  test("the landing page prints Rove state paths and branch names", () => {
    for (const path of ["packages/rove-landing/themes.html", "packages/rove-landing/themes.js"]) {
      expect(read(path), `${path} still writes themes to the legacy state dir`).not.toContain("~/.rove/themes/")
    }
    // The fan-out demo renders the branch Rove actually creates (`rove/<slug>`),
    // both in the animated JS and in the static markup the animation replaces.
    expect(read("packages/rove-landing/index.js"), "the fan-out demo still prints rove/ branches").not.toContain(
      "'rove/'",
    )
    // The canonical domain is now `rove.run`; every sma1lboy.me host 301s to
    // it. Only a `rove/<branch>` slug is stale.
    expect(
      read("packages/rove-landing/index.html"),
      "the static fan-in fallback still prints a rove/ branch",
    ).not.toMatch(/\brove\/[a-z0-9]/i)
    for (const path of ["packages/rove-landing/themes.html", "packages/rove-landing/themes.js"]) {
      expect(read(path), `${path} still recommends the legacy theme topic`).not.toContain("rove-theme")
    }
  })

  test("generated docs illustrations render the Rove worktree root and branch prefix", () => {
    for (const path of ["packages/branding/src/docs/DocsFanOut.tsx", "packages/branding/src/docs/DocsTaskModel.tsx"]) {
      const source = read(path)
      expect(source, `${path} draws the legacy worktree root`).not.toContain("~/.rove/")
      expect(source, `${path} draws a legacy branch prefix`).not.toContain("rove/")
    }
  })

  test("brand metadata carries the canonical display name", () => {
    const meta = read("marketing/brand.meta.yaml")
    // `id:` stays "rove" — it keys marketing.studio.yaml and the accepted-asset
    // ledger. Only the display names are the product's public name.
    expect(meta, "brand.meta.yaml still names the product rove").not.toMatch(/^\s*name:\s*"rove"\s*$/m)
    expect(meta, "brand.meta.yaml still carries the legacy-name basketball association").not.toContain(
      "basketball references",
    )
  })

  test("the preview installer teaches the canonical executable", () => {
    const source = read("scripts/preview-install.sh")
    const command = TYPED_ROVE_COMMAND.exec(source)
    expect(command?.[0], `preview-install.sh still teaches "${command?.[0]}"`).toBeUndefined()
    expect(source, "preview-install.sh still verifies the compatibility executable").not.toContain("rove -v")
  })

  test("active developer tooling labels Rove", () => {
    expect(read("packages/rove/scripts/pty-soak.ts"), "the PTY soak banner still labels Rove").not.toContain(
      "rove pty soak",
    )
    const webReadme = read("packages/rove-harness/README.md")
    expect(webReadme, "the web README still calls the product Rove").not.toMatch(PRODUCT_NAME_ROVE)
    expect(webReadme, "the web README still teaches the compatibility CLI").not.toMatch(TYPED_ROVE_COMMAND)
  })
})
