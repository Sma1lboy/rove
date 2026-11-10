/**
 * `dist/relay/index.html`: the relay shell (`src/relay-shell.ts`) as one self-contained file, so
 * `rove --web --relay-shell <dir>` can drop it into a Worker's static assets. Its CSP pins the one
 * inline script by hash; the client it then loads from the bridge runs as a `blob:` script.
 */

import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"

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
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>rove</title>
    <style>html,body{margin:0;background:#1a1a1a;color:#ccc;font:14px ui-monospace,monospace}#relay-status{padding:24px}</style>
  </head>
  <body>
    <div id="root"><p id="relay-status"></p></div>
    <script type="module">${js}</script>
  </body>
</html>
`
mkdirSync("dist/relay", { recursive: true })
writeFileSync("dist/relay/index.html", html)
console.log(`dist/relay/index.html ${(html.length / 1024).toFixed(1)} kB`)
