/**
 * `dist/relay/index.html`: the relay shell (`src/relay-shell.ts`) as one self-contained file, so
 * `rove --web --relay-shell <dir>` can drop it into a Worker's static assets. Its CSP pins the one
 * inline script by hash; the client it then loads from the bridge (`dist/relay-client`, one unsplit script) runs as a
 * `blob:` script.
 */

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { build } from "vite"

// The client the shell loads, as one script: it runs from a `blob:` URL, where a chunk's `./x.js` import cannot resolve.
await build({
  base: "/relay-client/",
  logLevel: "warn",
  build: { outDir: "dist/relay-client", emptyOutDir: true, rolldownOptions: { output: { codeSplitting: false } } },
})

const built = await Bun.build({ entrypoints: ["src/relay-shell.ts"], target: "browser", minify: true })
if (!built.success) throw new AggregateError(built.logs, "relay shell build failed")
const js = (await built.outputs[0]?.text()) ?? ""
if (js.includes("</script")) throw new Error("relay shell bundle contains </script; it cannot be inlined")
const hash = createHash("sha256").update(js).digest("base64")
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${hash}' blob:`,
  "style-src 'unsafe-inline'",
  "font-src blob: data:",
  "img-src data: blob:",
  "media-src data: blob:",
  // The relay is this origin, or another one the link names (`#relay=`).
  "connect-src 'self' ws: wss:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")
// Tokens mirror rove-web's default `claude` theme (`packages/rove-core/src/theme/claude.json` + `prefs-theme.ts` quietInks)
// and are prefixed `--rs-*` so they never collide with `tailwind.css` once the app stylesheet mounts.
const css = [
  ":root{--rs-paper:#141413;--rs-surface:#1a1917;--rs-line:#3a3835;--rs-ink:#eae7df;--rs-muted:#a9a39a;--rs-subtle:#9d9a95;--rs-accent:#cc785c;--rs-error:#ec6f74;--rs-hover:rgba(234,231,223,.07);color-scheme:dark}",
  "@media (prefers-color-scheme:light){:root{--rs-paper:#faf9f5;--rs-surface:#f0eee6;--rs-line:#d9d5cc;--rs-ink:#1a1917;--rs-muted:#5e5953;--rs-subtle:#66615a;--rs-accent:#b5532f;--rs-error:#ad2f36;--rs-hover:rgba(26,25,23,.07);color-scheme:light}}",
  "html,body{height:100%;margin:0}",
  'body{background:var(--rs-paper);color:var(--rs-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}',
  "#root{box-sizing:border-box;height:100%;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}",
  "#relay-splash{box-sizing:border-box;min-height:100%;display:grid;grid-template-rows:1fr auto 1fr;justify-items:center;padding:24px;text-align:center}",
  '#relay-logo{grid-row:2;font:700 22px/1 "JetBrains Mono","IBM Plex Mono","SF Mono",Menlo,Consolas,ui-monospace,monospace;letter-spacing:.02em;white-space:nowrap;user-select:none;-webkit-user-select:none}',
  "#relay-logo .b{color:var(--rs-accent)}",
  "#relay-body{grid-row:3;align-self:start;display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:16px;max-width:34ch}",
  "#relay-status{margin:0;font-size:13px;line-height:1.5;color:var(--rs-subtle);opacity:0;transition:opacity 200ms ease-out}",
  "#relay-status[data-visible]{opacity:1}",
  '#relay-status[data-tone="info"]{font-size:14px;color:var(--rs-muted)}',
  '#relay-status[data-tone="error"]{font-size:14px;color:var(--rs-error)}',
  '#relay-retry{font:500 13px/1 "JetBrains Mono","IBM Plex Mono","SF Mono",Menlo,Consolas,ui-monospace,monospace;color:var(--rs-ink);background:var(--rs-surface);border:1px solid var(--rs-line);border-radius:6px;padding:10px 18px;min-height:44px;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;transition:transform 120ms ease-out}',
  "@media (min-resolution:2dppx){#relay-retry{border-width:.5px}}",
  "#relay-retry[hidden]{display:none}",
  "#relay-retry:hover{background:var(--rs-hover)}",
  "#relay-retry:active{transform:scale(.97)}",
  "#relay-retry:focus-visible{outline:1px solid var(--rs-accent);outline-offset:2px}",
  "@media (prefers-reduced-motion:reduce){#relay-status,#relay-retry{transition:none}#relay-retry:active{transform:none}}",
].join("")
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>rove</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"><main id="relay-splash"><div id="relay-logo" aria-label="rove"><span class="b" aria-hidden="true">[</span> rove <span class="b" aria-hidden="true">]</span></div><div id="relay-body"><p id="relay-status" role="status" aria-live="polite"></p><button id="relay-retry" type="button" hidden></button></div></main></div>
    <script type="module">${js}</script>
  </body>
</html>
`
mkdirSync("dist/relay", { recursive: true })
writeFileSync("dist/relay/index.html", html)
console.log(`dist/relay/index.html ${(html.length / 1024).toFixed(1)} kB`)
