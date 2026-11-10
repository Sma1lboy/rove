// Builds the local copy of the Rove design system (synced from the claude.ai Design System artifact).
//   tokens.css               — every token as a CSS variable; dark on :root, light under [data-theme="light"]
//   rove-design-system.html  — one self-contained page: brand book, tokens, logos and live component previews
// Run: node packages/branding/design-system/build.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "project");
const read = (p) => readFileSync(join(project, p), "utf8");
const tokens = JSON.parse(read("tokens.json"));
const index = JSON.parse(read("design-system.json"));

// ---- tokens.css ----
const cssValue = (v) => (typeof v === "string" ? v.replace(/^\{(.+)\}$/, "var(--$1)") : String(v));
const themes = tokens.color.themes.map((t) => t.id);
const [primary] = themes;
const colorFor = (tok, theme) => {
  const v = typeof tok.value === "string" ? { [primary]: tok.value } : tok.value;
  return cssValue(v[theme] ?? v[primary]);
};
// A dot is not legal in a custom property name unescaped: `space-0.5` → `--space-0\.5`.
const ident = (name) => name.replace(/\./g, "\\.");
const block = (sel, lines) => `${sel} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n`;

const rootLines = [
  ...tokens.color.tokens.map((t) => `--${ident(t.name)}: ${colorFor(t, primary)};`),
  ...Object.entries(tokens.type.families).map(([k, v]) => `--font-${k}: ${v};`),
];
for (const [family, def] of Object.entries(tokens)) {
  if (family === "color" || family === "type" || !def?.tokens) continue;
  for (const t of def.tokens) rootLines.push(`--${ident(t.name)}: ${cssValue(t.value)};`);
}
let tokensCss = `/* ${index.title} — generated from tokens.json */\n`;
tokensCss += block(`:root, [data-theme="${primary}"]`, [`color-scheme: ${primary};`, ...rootLines]);
for (const theme of themes.slice(1)) {
  tokensCss += block(`[data-theme="${theme}"]`, [
    `color-scheme: ${theme};`,
    ...tokens.color.tokens.map((t) => `--${ident(t.name)}: ${colorFor(t, theme)};`),
  ]);
}
writeFileSync(join(here, "tokens.css"), tokensCss);

// ---- page ----
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

// Enough markdown for these READMEs: headings, lists, tables, fenced code, paragraphs.
function md(src) {
  const out = [];
  const lines = src.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length + 1, 6);
      out.push(`<h${level}>${inline(line.replace(/^#+ /, ""))}</h${level}>`);
      i++;
    } else if (/^\s*[-*] /.test(line)) {
      const items = [];
      for (; i < lines.length && /^\s*[-*] /.test(lines[i]); i++) items.push(`<li>${inline(lines[i].replace(/^\s*[-*] /, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (line.startsWith("|")) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push(
        `<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(#|```|\s*[-*] |\|)/.test(lines[i]); i++) para.push(lines[i]);
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

const bundleCss = read("components/bundle.css");
const previewDoc = (html) => {
  const body = html.replace(/^<!--[^\n]*-->\s*/, "");
  const style = `<style>${tokensCss}\n${bundleCss}</style>`;
  return body.includes("</head>") ? body.replace("</head>", `${style}</head>`) : style + body;
};
const cardHeight = (html) => Number(html.match(/height=(\d+)/)?.[1] ?? 120);
const cardGroup = (html) => html.match(/group="([^"]+)"/)?.[1] ?? "Other";

const comps = readdirSync(join(project, "components"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "Cover")
  .map((d) => {
    const preview = read(`components/${d.name}/preview.html`);
    const readme = existsSync(join(project, "components", d.name, "README.md")) ? read(`components/${d.name}/README.md`) : "";
    return { name: d.name, preview, readme, group: cardGroup(preview) };
  })
  .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));

const frame = (title, html) =>
  `<iframe class="preview" title="${esc(title)}" style="height:${cardHeight(html)}px" srcdoc="${esc(previewDoc(html))}"></iframe>`;

const swatches = tokens.color.tokens
  .map(
    (t) => `<div class="tok"><div class="sw" style="background:var(--${t.name})"></div><div><code>--${t.name}</code>
<div class="vals">${themes.map((th) => `${th} <code>${esc(colorFor(t, th))}</code>`).join(" · ")}</div><p>${inline(t.usage ?? "")}</p></div></div>`,
  )
  .join("");

const tokenTables = Object.entries(tokens)
  .filter(([k, v]) => k !== "color" && k !== "type" && v?.tokens)
  .map(
    ([k, v]) => `<h3>${esc(k)}</h3>${v.note ? `<p class="note">${inline(v.note)}</p>` : ""}<table><tbody>${v.tokens
      .map((t) => `<tr><td><code>--${esc(t.name)}</code></td><td><code>${esc(t.value)}</code></td><td>${inline(t.usage ?? "")}</td></tr>`)
      .join("")}</tbody></table>`,
  )
  .join("");

const typeStyles = tokens.type.groups
  .map(
    (g) => `<h3>${esc(g.name)}</h3>${g.styles
      .map(
        (s) => `<div class="ts"><div style="font-family:var(--font-${g.family});font-size:${s.fontSize};font-weight:${s.fontWeight};${
          s.lineHeight ? `line-height:${s.lineHeight};` : ""
        }${s.letterSpacing ? `letter-spacing:${s.letterSpacing};` : ""}">${esc(s.sample ?? s.name)}</div><div class="vals"><code>${esc(s.name)}</code> ${esc(
          s.fontSize,
        )} / ${esc(s.fontWeight)} — ${inline(s.usage ?? "")}</div></div>`,
      )
      .join("")}`,
  )
  .join("");

const logos = index.groups
  .flatMap((g) => index.assetGroups[g].order.map((name) => ({ g, name, type: index.assetGroups[g].files[name].type })))
  .map(({ g, name, type }) => {
    const data = readFileSync(join(project, "assets", g, name)).toString("base64");
    return `<figure><img src="data:${type};base64,${data}" alt="${esc(name)}"><figcaption><code>${esc(name)}</code></figcaption></figure>`;
  })
  .join("");

const sections = [];
for (const f of readdirSync(project).filter((f) => f.endsWith(".md") && f !== "README.md")) sections.push(md(read(f)));

const page = `<!doctype html>
<html lang="en" data-theme="${primary}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(index.title)} Design System</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${tokensCss}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: var(--fs-body)/1.55 var(--font-sans); font-variant-numeric: tabular-nums; }
header { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 16px; padding: 10px 24px; background: var(--paper); border-bottom: var(--hairline) solid var(--line); }
header .wm { font: 700 14px var(--font-mono); letter-spacing: .02em; } header .wm b { color: var(--accent); }
header nav { display: flex; gap: 14px; flex: 1; overflow-x: auto; } header a { color: var(--muted); text-decoration: none; font: var(--fs-meta) var(--font-mono); white-space: nowrap; } header a:hover { color: var(--ink); }
header button { font: var(--fs-meta) var(--font-mono); color: var(--ink); background: var(--inset); border: var(--hairline) solid var(--line); border-radius: var(--radius-sm); padding: 4px 10px; cursor: pointer; }
main { max-width: 1000px; margin: 0 auto; padding: 0 24px 80px; }
section { padding-top: 32px; }
h2 { font: 600 16px var(--font-mono); margin: 0 0 14px; } h3 { font: 600 14px var(--font-sans); margin: 22px 0 8px; } h4, h5 { font-size: 13px; margin: 16px 0 6px; }
p, li { color: var(--ink); max-width: 72ch; } .note, .vals, figcaption { color: var(--muted); font-size: var(--fs-meta); }
code { font: var(--fs-meta) var(--font-mono); background: var(--inset); padding: 1px 4px; border-radius: var(--radius-xs); }
pre { background: var(--inset); padding: 12px; border-radius: var(--radius-sm); overflow-x: auto; } pre code { background: none; padding: 0; }
a { color: var(--accent); }
table { border-collapse: collapse; width: 100%; font-size: var(--fs-meta); } td, th { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: var(--hairline) solid var(--line); }
.cover { border-radius: var(--radius); overflow: hidden; border: var(--hairline) solid var(--line); margin-top: 24px; }
.toks { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.tok { display: flex; gap: 12px; } .tok p { margin: 4px 0 0; font-size: var(--fs-meta); color: var(--muted); }
.sw { flex: none; width: 44px; height: 44px; border-radius: var(--radius-sm); border: var(--hairline) solid var(--line); }
.ts { padding: 8px 0; border-bottom: var(--hairline) solid var(--line); }
.logos { display: flex; gap: 24px; flex-wrap: wrap; } figure { margin: 0; } figure img { width: 128px; height: 128px; border-radius: var(--radius); display: block; }
.comp { border: var(--hairline) solid var(--line); border-radius: var(--radius); margin-bottom: 20px; overflow: hidden; }
.comp .head { padding: 10px 16px; border-bottom: var(--hairline) solid var(--line); font: 600 var(--fs-meta) var(--font-mono); display: flex; gap: 10px; } .comp .head span { color: var(--subtle); font-weight: 400; }
.preview { display: block; width: 100%; border: 0; background: var(--paper); }
.comp .doc { padding: 4px 16px 12px; border-top: var(--hairline) solid var(--line); } .comp .doc h2 { display: none; }
</style>
</head>
<body>
<header>
  <span class="wm"><b>[</b> rove <b>]</b></span>
  <nav><a href="#brand">Brand book</a><a href="#colour">Colour</a><a href="#type">Type</a><a href="#scale">Scales</a><a href="#logos">Logos</a><a href="#components">Components</a></nav>
  <button id="theme" type="button">light</button>
</header>
<main>
  <div class="cover">${frame("Cover", read("components/Cover/preview.html"))}</div>
  <section id="brand"><h2>Brand book</h2>${md(read("README.md"))}${sections.join("\n")}</section>
  <section id="colour"><h2>Colour</h2><div class="toks">${swatches}</div></section>
  <section id="type"><h2>Type</h2><p class="note">mono: <code>${esc(tokens.type.families.mono)}</code><br>sans: <code>${esc(tokens.type.families.sans)}</code></p>${typeStyles}</section>
  <section id="scale"><h2>Scales</h2>${tokenTables}</section>
  <section id="logos"><h2>Logos</h2><div class="logos">${logos}</div>${md(read("assets/Logos/README.md"))}</section>
  <section id="components"><h2>Components</h2>${comps
    .map((c) => `<div class="comp"><div class="head">${esc(c.name)}<span>${esc(c.group)}</span></div>${frame(c.name, c.preview)}${c.readme ? `<div class="doc">${md(c.readme)}</div>` : ""}</div>`)
    .join("\n")}</section>
  <p class="note">Synced ${esc(tokens.meta?.synced ?? "")} from ${esc(tokens.meta?.repo ?? "")}@${esc(tokens.meta?.ref ?? "")}. Last change: ${esc(index.lastChange?.note ?? "")}</p>
</main>
<script>
const themes = ${JSON.stringify(themes)};
const btn = document.getElementById("theme");
function apply(t) {
  document.documentElement.dataset.theme = t;
  btn.textContent = themes[(themes.indexOf(t) + 1) % themes.length];
  for (const f of document.querySelectorAll("iframe")) f.contentDocument?.documentElement?.setAttribute("data-theme", t);
}
btn.addEventListener("click", () => apply(btn.textContent));
for (const f of document.querySelectorAll("iframe")) f.addEventListener("load", () => {
  const doc = f.contentDocument.documentElement;
  doc.setAttribute("data-theme", document.documentElement.dataset.theme);
  // The @dsCard height is a floor; grow to fit so no preview scrolls inside its card.
  if (!f.closest(".cover")) f.style.height = Math.max(f.offsetHeight, doc.scrollHeight) + "px";
});
</script>
</body>
</html>
`;
writeFileSync(join(here, "rove-design-system.html"), page);
console.log(`tokens.css + rove-design-system.html (${(page.length / 1024).toFixed(0)} KB)`);
