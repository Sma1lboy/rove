/**
 * Data half of the ops preview window (`tui/ops/preview-core.ts`).
 * `loadPreviewData` decides which renderable the preview mounts — a dirty
 * file MUST render as a `<diff>` vs HEAD and a clean/untracked one as its
 * `<code>` content — and `filetypeOf` picks the tree-sitter grammar. Both
 * live here rather than inside the untestable host.tsx.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import {
  filetypeOf,
  hunklessPatchNote,
  isCombinedPathspec,
  isImagePath,
  loadFileContent,
  loadPreviewData,
  patchFirstLine,
  unifiedDiffFiles,
} from "../../src/tui/ops/preview-core.ts"

describe("filetypeOf", () => {
  test("maps known extensions to their tree-sitter grammar and unknown ones to undefined", () => {
    expect(filetypeOf("src/a.ts")).toBe("typescript")
    expect(filetypeOf("src/a.tsx")).toBe("typescript")
    expect(filetypeOf("a.mjs")).toBe("javascript")
    expect(filetypeOf("README.markdown")).toBe("markdown")
    expect(filetypeOf("Makefile")).toBeUndefined()
    expect(filetypeOf("img.png")).toBeUndefined()
    expect(filetypeOf("build.zig")).toBe("zig")
  })

  test.each([
    ["-S -u NODE_OPTIONS node", "javascript"],
    ["-S -u node /bin/echo", undefined],
    ["-S /usr/bin/node", "javascript"],
    ["-S --unset NODE_OPTIONS /usr/bin/node", "javascript"],
    ["-S --unset=node /bin/echo", undefined],
    ["-S -unode /bin/echo", undefined],
    ["-S -C node /bin/echo", undefined],
    ["-S --chdir node /usr/bin/bun", "typescript"],
    ["-S -P node /bin/echo", undefined],
    ["-S -i NODE_OPTIONS= -- /usr/bin/node", "javascript"],
    ["-S -u node", undefined],
  ])("selects the command after env options: %s", (args, expected) => {
    expect(filetypeOf("bin/cli", `#!/usr/bin/env ${args}`)).toBe(expected)
  })

  test("an extensionless script takes its grammar from the shebang's interpreter", () => {
    expect(filetypeOf("bin/cli", "#!/usr/bin/env node")).toBe("javascript")
    expect(filetypeOf("bin/cli", "#!/usr/bin/env -S bun run --silent")).toBe("typescript")
    expect(filetypeOf("scripts/dev", "#!/usr/local/bin/deno run -A")).toBe("typescript")
    expect(filetypeOf("bin/cli", "#!/bin/sh")).toBeUndefined()
    expect(filetypeOf("bin/cli", "// node")).toBeUndefined()
    // A bare name that happens to be an extension is not one.
    expect(filetypeOf("bin/ts")).toBeUndefined()
    // An extension wins over the shebang.
    expect(filetypeOf("notes.md", "#!/usr/bin/env node")).toBe("markdown")
  })
})

describe("patchFirstLine", () => {
  test("reads line 1 only from a hunk that starts there", () => {
    const added =
      "diff --git a/cli b/cli\nnew file mode 100755\n--- /dev/null\n+++ b/cli\n@@ -0,0 +1,2 @@\n+#!/usr/bin/env node\n+run()\n"
    expect(patchFirstLine(added)).toBe("#!/usr/bin/env node")
    const replaced = "@@ -1,2 +1,2 @@\n-#!/bin/sh\n+#!/usr/bin/env bun\n x\n"
    expect(patchFirstLine(replaced)).toBe("#!/usr/bin/env bun")
    expect(patchFirstLine("@@ -40,3 +40,4 @@\n a\n+#!/usr/bin/env node\n b\n")).toBeUndefined()
  })
})

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rove-preview-core-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
  execFileSync("git", ["add", "a.ts"], { cwd: dir })
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir })
  return dir
}

describe("loadPreviewData", () => {
  test("a changed file previews as the unified diff vs HEAD", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "a.ts"), "export const a = 2\n")
    const data = await loadPreviewData(repo, "a.ts")
    if (data.kind !== "diff") throw new Error(`expected diff, got ${data.kind}`)
    expect(data.text).toContain("-export const a = 1")
    expect(data.text).toContain("+export const a = 2")
  })

  test("loadFileContent reads a changed file as itself, not its diff", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "a.ts"), "export const a = 2\n")
    expect(await loadFileContent(repo, "a.ts")).toEqual({ kind: "code", text: "export const a = 2\n" })
  })

  test("ignoreWhitespace drops a whitespace-only file from the combined diff and keeps real edits", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "b.ts"), "if (x) {\n  y()\n}\n")
    execFileSync("git", ["add", "b.ts"], { cwd: repo })
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "b"], { cwd: repo })
    writeFileSync(join(repo, "a.ts"), "export const a = 2\n")
    writeFileSync(join(repo, "b.ts"), "if (x) {\n    y()\n}\n")
    const all = await loadPreviewData(repo, ".")
    const quiet = await loadPreviewData(repo, ".", undefined, { ignoreWhitespace: true })
    if (all.kind !== "diff" || quiet.kind !== "diff") throw new Error("expected diffs")
    expect(all.text).toContain("diff --git a/b.ts b/b.ts")
    expect(quiet.text).not.toContain("b.ts")
    expect(quiet.text).toContain("+export const a = 2")
  })

  test("a clean file previews as its content", async () => {
    const repo = makeRepo()
    const data = await loadPreviewData(repo, "a.ts")
    expect(data).toEqual({ kind: "code", text: "export const a = 1\n" })
  })

  // Why: a PNG decoded as utf8 renders as mojibake — image extensions and
  // null-byte content must route to the binary card, never <code>/<diff>.
  test("an image file previews as a binary card with its byte size", async () => {
    const repo = makeRepo()
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
    writeFileSync(join(repo, "shot.png"), bytes)
    const data = await loadPreviewData(repo, "shot.png")
    expect(data).toEqual({ kind: "binary", image: true, sizeBytes: bytes.length })
  })

  test("a non-image file with null bytes previews as a non-image binary card", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "blob.dat"), Buffer.from("abc\u0000def"))
    const data = await loadPreviewData(repo, "blob.dat")
    expect(data).toMatchObject({ kind: "binary", image: false })
  })

  // A directory is a git pathspec, and git already answers it with the
  // multi-file unified diff `<diff>` renders — the pane refused it, not git.
  test("a directory pathspec previews as the combined diff of every file under it", async () => {
    const repo = makeRepo()
    execFileSync("git", ["mv", "a.ts", "src-a.ts"], { cwd: repo })
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "move"], { cwd: repo })
    execFileSync("mkdir", ["-p", join(repo, "src")], { cwd: repo })
    writeFileSync(join(repo, "src", "one.ts"), "export const one = 1\n")
    writeFileSync(join(repo, "src", "two.ts"), "export const two = 2\n")
    execFileSync("git", ["add", "src"], { cwd: repo })
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "two"], { cwd: repo })
    writeFileSync(join(repo, "src", "one.ts"), "export const one = 11\n")
    writeFileSync(join(repo, "src", "two.ts"), "export const two = 22\n")
    const data = await loadPreviewData(repo, "src/")
    if (data.kind !== "diff") throw new Error(`expected diff, got ${data.kind}`)
    expect(data.text).toContain("src/one.ts")
    expect(data.text).toContain("src/two.ts")
  })

  // The file path falls back to the file's own content; a directory has none,
  // and falling through would render a blank pane instead of saying so.
  test("a combined pathspec with no changes reports empty, never a blank code view", async () => {
    const repo = makeRepo()
    expect(await loadPreviewData(repo, "src/")).toEqual({ kind: "empty" })
    expect(await loadPreviewData(repo, ".")).toEqual({ kind: "empty" })
  })

  // The Changes list shows `? NOTES.md`; "diff everything" said "no changes" for the same task.
  test("a combined diff of uncommitted work includes untracked files, not ignored ones", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, ".gitignore"), "build.log\n")
    writeFileSync(join(repo, "NOTES.md"), "restart path audit\n")
    writeFileSync(join(repo, "build.log"), "noise\n")
    const data = await loadPreviewData(repo, ".")
    if (data.kind !== "diff") throw new Error(`expected diff, got ${data.kind}`)
    expect(data.text).toContain("+++ b/NOTES.md")
    expect(data.text).toContain("+restart path audit")
    expect(data.text).toContain("+++ b/.gitignore")
    expect(data.text).not.toContain("build.log\n+noise")
    expect(await loadPreviewData(repo, "src/")).toEqual({ kind: "empty" })
  })

  // A 21 MB recorded JSON made the whole-worktree reply 30 MB; the web panel never left "loading…".
  test("a combined diff lists a huge untracked file without its contents, and every file past the budget too", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "huge.json"), `${"x".repeat(1024)}\n`.repeat(1024))
    for (const n of [1, 2, 3]) writeFileSync(join(repo, `part${n}.txt`), `${"y".repeat(1023)}\n`.repeat(400))
    const data = await loadPreviewData(repo, ".")
    if (data.kind !== "diff") throw new Error(`expected diff, got ${data.kind}`)
    const files = unifiedDiffFiles(data.text)
    expect(files.map((f) => f.path)).toEqual(["huge.json", "part1.txt", "part2.txt", "part3.txt"])
    expect(files.map((f) => f.note?.kind ?? "text")).toEqual(["binary", "text", "text", "binary"])
    expect(data.text.length).toBeLessThan(1024 * 1024)
  })
})

describe("isCombinedPathspec", () => {
  test("only the whole worktree and trailing-slash directories span files", () => {
    expect(isCombinedPathspec(".")).toBe(true)
    expect(isCombinedPathspec("src/")).toBe(true)
    expect(isCombinedPathspec("a/b/")).toBe(true)
    expect(isCombinedPathspec("src/a.ts")).toBe(false)
    expect(isCombinedPathspec("a.ts")).toBe(false)
  })
})

// opentui's DiffRenderable keeps only `patches[0]`, so a combined diff handed
// over whole renders its first file and drops the rest. The view stacks one
// `<diff>` per entry instead, and each needs an explicit row count.
describe("unifiedDiffFiles", () => {
  const TWO_FILES = [
    "diff --git a/src/auth.ts b/src/auth.ts",
    "index eb7d33f..1e391ec 100644",
    "--- a/src/auth.ts",
    "+++ b/src/auth.ts",
    "@@ -1,3 +1,3 @@",
    "-export function login(user: string) {",
    "+export function login(user: string, token: string) {",
    " }",
    "diff --git a/src/session.ts b/src/session.ts",
    "index 3572d91..708d773 100644",
    "--- a/src/session.ts",
    "+++ b/src/session.ts",
    "@@ -1 +1,2 @@",
    "-export const TTL = 900",
    "+export const TTL = 1800",
    "+export const IDLE = 300",
    "",
  ].join("\n")

  test("splits on the git header and keeps each patch parseable on its own", () => {
    const files = unifiedDiffFiles(TWO_FILES)
    expect(files.map((f) => f.path)).toEqual(["src/auth.ts", "src/session.ts"])
    expect(files[0]?.text).toContain("@@ -1,3 +1,3 @@")
    expect(files[0]?.text.startsWith("diff --git a/src/auth.ts")).toBe(true)
    // The second file's patch must NOT carry the first one's hunks.
    expect(files[1]?.text).not.toContain("login")
  })

  test("counts only the rows a hunk body draws — not the ---/+++ preamble", () => {
    const files = unifiedDiffFiles(TWO_FILES)
    expect(files[0]?.lines).toBe(3)
    expect(files[1]?.lines).toBe(3)
  })

  test("a single-file diff comes back as one entry, and empty text as none", () => {
    expect(unifiedDiffFiles("").length).toBe(0)
    const one = unifiedDiffFiles(TWO_FILES.split("diff --git a/src/session.ts")[0] ?? "")
    expect(one.length).toBe(1)
  })
})

describe("binary detection helpers", () => {
  test("isImagePath keys off the extension, case-insensitively", () => {
    expect(isImagePath("a/b/shot.PNG")).toBe(true)
    expect(isImagePath("photo.jpeg")).toBe(true)
    expect(isImagePath("doc.pdf")).toBe(false)
    expect(isImagePath("src/a.ts")).toBe(false)
  })
})

/**
 * A patch git expressed entirely in its preamble. `<diff>` draws hunk rows
 * and nothing else, so these used to render as a blank pane — an answer that
 * cannot be told apart from "nothing changed", which is the one thing the
 * patch proves false.
 */
describe("hunklessPatchNote", () => {
  test("a patch with hunks is not a note — it renders as a diff", () => {
    expect(hunklessPatchNote(TWO_FILE_SAMPLE)).toBeNull()
  })

  // A file can change its mode AND its content in one commit. Reading the
  // preamble alone would hide the hunks behind a `mode changed` card.
  test("a mode change that also has hunks stays a diff", () => {
    const patch = [
      "diff --git a/src/run.sh b/src/run.sh",
      "old mode 100644",
      "new mode 100755",
      "index 1234567..89abcde",
      "--- a/src/run.sh",
      "+++ b/src/run.sh",
      "@@ -1,2 +1,2 @@",
      " #!/bin/sh",
      "-echo hi",
      "+echo bye",
      "",
    ].join("\n")
    expect(hunklessPatchNote(patch)).toBeNull()
  })
})

const TWO_FILE_SAMPLE = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n")

describe("unifiedDiffFiles labels and hunk-less sections", () => {
  // git C-quotes any non-ASCII path, so the header has no ` b/` to split on
  // and the label used to show raw octal escapes and BOTH sides at once.
  test("a C-quoted non-ASCII path is decoded to the b-side alone", () => {
    const patch = [
      'diff --git "a/src/notes \\344\\270\\255\\346\\226\\207.md" "b/src/notes \\344\\270\\255\\346\\226\\207.md"',
      "index 9c59e24..ea18402 100644",
      '--- "a/src/notes \\344\\270\\255\\346\\226\\207.md"\t',
      '+++ "b/src/notes \\344\\270\\255\\346\\226\\207.md"\t',
      "@@ -1 +1,2 @@",
      " first",
      "+second",
      "",
    ].join("\n")
    expect(unifiedDiffFiles(patch).map((f) => f.path)).toEqual(["src/notes 中文.md"])
  })

  // git does NOT quote spaces, so the header alone is ambiguous; the `+++`
  // line is one field to end-of-line and settles it.
  test("a path containing a space keeps its space", () => {
    const patch = [
      "diff --git a/src/a b.txt b/src/a b.txt",
      "index 587be6b..b77b4eb 100644",
      "--- a/src/a b.txt\t",
      "+++ b/src/a b.txt\t",
      "@@ -1 +1,2 @@",
      " x",
      "+y",
      "",
    ].join("\n")
    expect(unifiedDiffFiles(patch).map((f) => f.path)).toEqual(["src/a b.txt"])
  })

  test("a deletion is labelled by its own path, not /dev/null", () => {
    const patch = [
      "diff --git a/src/obsolete.txt b/src/obsolete.txt",
      "deleted file mode 100644",
      "--- a/src/obsolete.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-delete me",
      "",
    ].join("\n")
    expect(unifiedDiffFiles(patch).map((f) => f.path)).toEqual(["src/obsolete.txt"])
  })

  test("a rename's section is labelled by the NEW path", () => {
    const patch = [
      "diff --git a/src/legacy.txt b/src/renamed-core.txt",
      "similarity index 94%",
      "rename from src/legacy.txt",
      "rename to src/renamed-core.txt",
      "--- a/src/legacy.txt",
      "+++ b/src/renamed-core.txt",
      "@@ -1 +1 @@",
      "-line 5",
      "+line 5 RENAMED",
      "",
    ].join("\n")
    expect(unifiedDiffFiles(patch).map((f) => f.path)).toEqual(["src/renamed-core.txt"])
  })

  // A section whose patch has no hunks got `height={0}` — a bare filename
  // over empty space. It must carry what changed instead.
  test("hunk-less sections carry a note so no section renders over zero rows", () => {
    const patch = [
      "diff --git a/assets/bundle.zip b/assets/bundle.zip",
      "index eda69c0..8dd93b0 100644",
      "Binary files a/assets/bundle.zip and b/assets/bundle.zip differ",
      "diff --git a/src/run.sh b/src/run.sh",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n")
    const files = unifiedDiffFiles(patch)
    expect(files.map((f) => f.path)).toEqual(["assets/bundle.zip", "src/run.sh"])
    expect(files.map((f) => f.lines)).toEqual([0, 0])
    expect(files[0]?.note).toEqual({ kind: "binary" })
    expect(files[1]?.note).toEqual({ kind: "mode", from: "100644", to: "100755" })
  })
})

/** Real repos, because every one of these is a claim about what git emits. */
describe("loadPreviewData — failures and hunk-less patches are never 'no changes'", () => {
  function commit(repo: string, message: string): void {
    execFileSync("git", ["add", "-A"], { cwd: repo })
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message], { cwd: repo })
  }

  // Restricting the pathspec to the new path alone unpairs the rename, so git
  // reports every line as added: 60 green lines where the list row beside it
  // says `+1 −1` and the combined diff shows one changed line.
  test("a renamed file's diff shows the rename, not the whole file as added", async () => {
    const repo = makeRepo()
    const sixty = (edited: boolean): string =>
      `${Array.from({ length: 60 }, (_, i) => (edited && i === 4 ? "line 5 EDITED" : `line ${i + 1}`)).join("\n")}\n`
    writeFileSync(join(repo, "legacy.txt"), sixty(false))
    commit(repo, "base")
    execFileSync("git", ["mv", "legacy.txt", "renamed.txt"], { cwd: repo })
    writeFileSync(join(repo, "renamed.txt"), sixty(true))
    commit(repo, "rename")

    const data = await loadPreviewData(repo, "renamed.txt", { base: "HEAD~1" })
    if (data.kind !== "diff") throw new Error(`expected diff, got ${data.kind}`)
    expect(data.text).toContain("rename from legacy.txt")
    expect(data.text).toContain("rename to renamed.txt")
    expect(data.origPath).toBe("legacy.txt")
    // The patch's own counts now match the list row: one line each way.
    const added = data.text.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length
    const removed = data.text.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length
    expect([added, removed]).toEqual([1, 1])
  })

  test("an ordinary added file is still a plain add, not mislabelled a rename", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "fresh.ts"), "export const fresh = 1\n")
    commit(repo, "add")
    const data = await loadPreviewData(repo, "fresh.ts", { base: "HEAD~1" })
    if (data.kind !== "diff") throw new Error(`expected diff, got ${data.kind}`)
    expect(data.text).toContain("new file mode")
    expect(data.origPath).toBeUndefined()
  })

  test("a changed binary renders a stated card, never a blank pane", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "bundle.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))
    commit(repo, "base")
    writeFileSync(join(repo, "bundle.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x02, 0x03]))
    commit(repo, "change")
    const data = await loadPreviewData(repo, "bundle.zip", { base: "HEAD~1" })
    if (data.kind !== "patch-note") throw new Error(`expected patch-note, got ${data.kind}`)
    expect(data.note).toEqual({ kind: "binary" })
    expect(data.sizeBytes).toBe(7)
  })

  test("a mode-only change names both modes instead of rendering nothing", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "run.sh"), "#!/bin/sh\necho hi\n")
    commit(repo, "base")
    execFileSync("chmod", ["+x", join(repo, "run.sh")])
    commit(repo, "chmod")
    const data = await loadPreviewData(repo, "run.sh", { base: "HEAD~1" })
    if (data.kind !== "patch-note") throw new Error(`expected patch-note, got ${data.kind}`)
    expect(data.note).toEqual({ kind: "mode", from: "100644", to: "100755" })
  })

  // `status === 0 ? stdout : ""` collapsed "git refused" into "the diff was
  // empty", and the fallbacks then presented that as a fact: a single file
  // came back as its own CURRENT CONTENT, a directory as `no changes in src/`.
  test("an unresolvable base is an error carrying git's own stderr — for a file", async () => {
    const repo = makeRepo()
    const data = await loadPreviewData(repo, "a.ts", { base: "origin/gone" })
    if (data.kind !== "error") throw new Error(`expected error, got ${data.kind}`)
    expect(data.message).toMatch(/origin\/gone/)
    // The old behaviour: the file's own content rendered as a plain `file`.
    expect(data.message).not.toContain("export const a = 1")
  })

  test("an unresolvable base is an error — for a directory, not 'no changes'", async () => {
    const repo = makeRepo()
    const data = await loadPreviewData(repo, ".", { base: "origin/gone" })
    if (data.kind !== "error") throw new Error(`expected error, got ${data.kind}`)
    expect(data.message).toMatch(/origin\/gone/)
  })

  test("the whole task against its base holds commits, uncommitted edits and untracked files", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, "committed.ts"), "export const committed = 1\n")
    commit(repo, "work")
    writeFileSync(join(repo, "a.ts"), "export const a = 2\n")
    writeFileSync(join(repo, "untracked.ts"), "export const untracked = 1\n")

    const task = await loadPreviewData(repo, ".", { base: "HEAD~1", working: true })
    if (task.kind !== "diff") throw new Error(`expected diff, got ${task.kind}`)
    expect(unifiedDiffFiles(task.text).map((f) => f.path)).toEqual(["a.ts", "committed.ts", "untracked.ts"])
    // The committed-only range stays what it was: nothing uncommitted or untracked in it.
    const branch = await loadPreviewData(repo, ".", { base: "HEAD~1" })
    if (branch.kind !== "diff") throw new Error(`expected diff, got ${branch.kind}`)
    expect(unifiedDiffFiles(branch.text).map((f) => f.path)).toEqual(["committed.ts"])
  })
})

// The counterpart to the two bad-base cases above: with NO base asked for,
// git declining means there is nothing to diff against, and the file's own
// content is the honest answer — the standalone `rove ops --preview <file>`
// is pointed at directories that are not repos at all.
test("a preview outside any git repo still shows the file, not a git error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rove-preview-norepo-"))
  writeFileSync(join(dir, "note.txt"), "FIRST CONTENT\n")
  const data = await loadPreviewData(dir, "note.txt")
  if (data.kind !== "code") throw new Error(`expected code, got ${data.kind}`)
  expect(data.text).toContain("FIRST CONTENT")
})
