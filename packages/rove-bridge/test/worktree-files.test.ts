/**
 * `rove api panel-show --view browser --path`: the address a `panel` push carries, and what the bridge
 * serves there — only that task's worktree, only with the key, sandboxed away from the Rove page.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PanelFeed } from "../src/panels.ts"
import { serveWorktreeFile, withPageUrl } from "../src/worktree-files.ts"
import { AUTH, TOKEN, connect, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

function worktree(): string {
  const parent = mkdtempSync(join(tmpdir(), "rove-wt-"))
  const root = join(parent, "wt")
  mkdirSync(join(root, "out"), { recursive: true })
  mkdirSync(join(root, ".git"))
  writeFileSync(join(root, "out", "report.html"), "<link rel=stylesheet href=style.css><p>hi</p>")
  writeFileSync(join(root, "out", "style.css"), "p{color:red}")
  writeFileSync(join(root, ".git", "config"), "[remote] url=https://secret@example.com")
  writeFileSync(join(parent, "outside.txt"), "outside")
  symlinkSync(join(parent, "outside.txt"), join(root, "out", "escape.txt"))
  symlinkSync(join(root, "out", "style.css"), join(root, "inside.css"))
  return root
}

async function serve() {
  const root = worktree()
  const web = mkdtempSync(join(tmpdir(), "rove-web-"))
  writeFileSync(join(web, "index.html"), "<title>shell</title>")
  const panels = new PanelFeed()
  const api = {
    verb: async <T>(_verb: string, args: readonly string[]) =>
      ({ task: { worktreePath: args.join(" ").includes("T1") ? root : null } }) as T,
    rpc: async <T>() => ({}) as T,
  }
  const h = start({ panels, web: { root: web, pages: (req) => serveWorktreeFile(req, { token: TOKEN, api }) }, api })
  const page = await connect(h.url, AUTH)
  await page.call("ui.viewing", { taskId: null })
  const arrived = new Promise<void>((resolve) => page.ws.addEventListener("message", () => resolve()))
  panels.push(withPageUrl(TOKEN, { taskId: "T1", view: "browser" as const, path: "out/report.html", at: Date.now() }))
  await arrived
  const url = (page.pushes[0] as { data: { url: string } }).data.url
  return { base: h.url.replace("ws:", "http:").replace(/\/$/, ""), url }
}

describe("worktree files", () => {
  test("the push carries the address; the file and its siblings load from it, sandboxed", async () => {
    const { base, url } = await serve()
    expect(url).toMatch(/^\/worktree\/T1\/[\w-]+\/out\/report\.html$/)
    const res = await fetch(base + url)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("<p>hi</p>")
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts[^;]*;/)
    expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin")
    const sibling = await fetch(base + url.replace("report.html", "style.css"))
    expect(await sibling.text()).toBe("p{color:red}")
  })

  test("a wrong key, or another task's, is refused", async () => {
    const { base, url } = await serve()
    const key = url.split("/")[3] as string
    expect((await fetch(base + url.replace(key, "x".repeat(43)))).status).toBe(401)
    expect((await fetch(`${base}/worktree/T2/${key}/out/report.html`)).status).toBe(401)
  })

  test("nothing outside the worktree, through `..`, a symlink or .git", async () => {
    const { base, url } = await serve()
    const prefix = base + url.replace("out/report.html", "")
    expect((await fetch(`${prefix}out/escape.txt`)).status).toBe(404)
    expect((await fetch(`${prefix}..%2Foutside.txt`)).status).toBe(404)
    expect((await fetch(`${prefix}.git/config`)).status).toBe(404)
    // A symlink that stays inside is the file it names.
    expect(await (await fetch(`${prefix}inside.css`)).text()).toBe("p{color:red}")
  })
})
