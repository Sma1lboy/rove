import { describe, expect, test } from "bun:test"
import { HTML_POLICY, artifactKind, blobType, htmlDocument, textOf } from "../src/artifact.ts"

describe("artifact kinds", () => {
  test("the previewable types, by extension and whatever the case; nothing else", () => {
    expect(
      ["a/b.md", "R.MARKDOWN", "x.html", "x.htm", "p.svg", "p.PNG", "p.jpeg", "p.webp", "d.pdf"].map(artifactKind),
    ).toEqual(["md", "md", "html", "html", "svg", "image", "image", "image", "pdf"])
    expect(["a.ts", "README", "dir.v2/file", "x.md.bak", "."].map(artifactKind)).toEqual([null, null, null, null, null])
  })

  test("a blob's type comes from the path, so a reply cannot make an image a page", () => {
    expect(blobType("image", "a.jpg")).toBe("image/jpeg")
    expect(blobType("image", "a.gif")).toBe("image/gif")
    expect(blobType("svg", "a.svg")).toBe("image/svg+xml")
    expect(blobType("pdf", "a.pdf")).toBe("application/pdf")
  })
})

describe("html preview document", () => {
  test("the policy comes before any content, after a doctype that must stay first", () => {
    const withDoctype = htmlDocument("<!DOCTYPE html><html><script>x()</script></html>")
    expect(withDoctype.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(withDoctype.indexOf(HTML_POLICY)).toBeLessThan(withDoctype.indexOf("<script>"))
    const bare = htmlDocument("<script>x()</script>")
    expect(bare.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
  })

  test("the policy loads nothing from the network and allows no script", () => {
    expect(HTML_POLICY).toContain("default-src 'none'")
    expect(HTML_POLICY).not.toMatch(/script-src|https?:|\*/)
  })
})

describe("file bytes", () => {
  test("base64 decodes as utf-8 text", () => {
    expect(textOf(Buffer.from("héllo ✓", "utf8").toString("base64"))).toBe("héllo ✓")
  })
})
