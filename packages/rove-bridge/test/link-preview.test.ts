import { describe, expect, test } from "bun:test"
import { readHead } from "../src/ops/links.ts"

describe("link.preview head parsing", () => {
  test("title is decoded and a raster icon wins over an SVG one", () => {
    const html = `<title>a &quot;b&quot; &#x6211;
      c</title>
      <link rel="icon" type="image/svg+xml" href="/f.svg">
      <link rel="alternate icon" href="https://cdn.example/f.png">`
    expect(readHead(html, new URL("https://example.com/x"))).toEqual({
      title: 'a "b" 我 c',
      icon: "https://cdn.example/f.png",
    })
  })

  test("og:title and /favicon.ico stand in when the page declares neither", () => {
    const html = `<meta property="og:title" content="Only OG">`
    expect(readHead(html, new URL("https://example.com/a/b"))).toEqual({
      title: "Only OG",
      icon: "https://example.com/favicon.ico",
    })
  })
})
