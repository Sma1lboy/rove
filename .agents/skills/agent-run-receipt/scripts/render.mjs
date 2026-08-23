#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function usage() {
  return "Usage: bun render.mjs --input run.json [--output-dir DIR]\n";
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") return { help: true };
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
    result[token.slice(2)] = value;
    index += 1;
  }
  return result;
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncate(value, max) {
  const text = String(value || "").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function wrap(value, max, limit = 3) {
  const text = String(value || "").trim();
  if (!text) return [];
  const parts = /\s/.test(text) ? text.split(/\s+/) : [...text];
  const spacer = /\s/.test(text) ? " " : "";
  const lines = [];
  let line = "";
  for (const part of parts) {
    const next = line ? `${line}${spacer}${part}` : part;
    if (next.length > max && line) {
      lines.push(line);
      line = part;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > limit) {
    const kept = lines.slice(0, limit);
    kept[limit - 1] = truncate(kept[limit - 1], Math.max(2, max - 1));
    return kept;
  }
  return lines;
}

function tspans(lines, x, y, lineHeight, attrs = "") {
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" ${attrs}>${xml(line)}</text>`)
    .join("");
}

function taskNode(task, x, y, width, index, isOverflow = false) {
  const label = isOverflow ? "MORE AGENTS" : `AGENT ${String(index + 1).padStart(2, "0")}`;
  const title = wrap(task.title, width > 300 ? 31 : 25, 2);
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="112" class="node" />
      <text x="${x + 18}" y="${y + 26}" class="node-role">${xml(label)}</text>
      ${tspans(title, x + 18, y + 58, 21, 'class="node-title"')}
      <text x="${x + 18}" y="${y + 99}" class="node-meta">${xml(isOverflow ? task.vendor : `${task.vendor} · ${task.status}`)}</text>
    </g>`;
}

function render(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error(`unsupported schemaVersion: ${manifest.schemaVersion}`);
  if (!manifest.owner || !Array.isArray(manifest.tasks) || manifest.tasks.length < 2) {
    throw new Error("manifest must contain one owner and at least one worker");
  }

  const owner = manifest.owner;
  const workers = manifest.tasks.filter((task) => task.id !== owner.id);
  const visible = workers.slice(0, 6);
  if (workers.length > 6) {
    visible[5] = { id: "overflow", title: `+${workers.length - 5} additional agents`, vendor: "included in receipt", status: "" };
  }
  const positions = visible.map((task, index) => ({
    task,
    x: 68 + (index % 3) * 354,
    y: 666 + Math.floor(index / 3) * 132,
    width: 320,
    overflow: task.id === "overflow",
  }));

  const spawnEdges = manifest.edges.filter((edge) => edge.kind === "spawn");
  const messageEdges = manifest.edges.filter((edge) => edge.kind === "message");
  const messageCount = messageEdges.reduce((sum, edge) => sum + (Number(edge.count) || 1), 0);
  const batches = Array.isArray(manifest.batches) ? manifest.batches.length : 0;
  const pr = manifest.evidence?.pr;
  const git = manifest.evidence?.git || {};
  const headline = wrap(manifest.headline, 18, 2);
  const outcome = wrap(manifest.outcome, 36, 2);
  const ownerTitle = wrap(owner.title, 31, 2);

  const nodeById = new Map(positions.map((position) => [position.task.id, position]));
  const lines = spawnEdges
    .filter((edge) => nodeById.has(edge.to))
    .map((edge) => {
      const target = nodeById.get(edge.to);
      const targetX = target.x + target.width / 2;
      return `<path d="M 600 626 V 642 H ${targetX} V ${target.y - 4}" class="spawn" marker-end="url(#spawn-arrow)" />`;
    })
    .join("");

  const handoffs = messageEdges.slice(0, 4).map((edge, index) => {
    const from = manifest.tasks.find((task) => task.id === edge.from);
    const to = manifest.tasks.find((task) => task.id === edge.to);
    const preview = edge.preview ? truncate(edge.preview, 56) : `confirmed handoff ×${Number(edge.count) || 1}`;
    return `<g transform="translate(68 ${1024 + index * 42})">
      <text x="0" y="0" class="handoff-index">${String(index + 1).padStart(2, "0")}</text>
      <text x="42" y="0" class="handoff-route">${xml(`${truncate(from?.title || edge.from, 18)} → ${truncate(to?.title || edge.to, 18)}`)}</text>
      <text x="472" y="0" class="handoff-copy">${xml(preview)}</text>
    </g>`;
  }).join("");

  const checks = pr?.checks?.total ? `${pr.checks.passing}/${pr.checks.total}` : "—";
  const checksGreen = Boolean(pr?.checks?.total) && pr.checks.passing === pr.checks.total;
  const proofPositive = checksGreen || (!pr?.checks?.total && git.clean);
  const proofColor = proofPositive ? "#9ACA86" : "#CC785C";
  const proofLabel = pr?.checks?.total ? (checksGreen ? "CHECKS GREEN" : "CHECKS REVIEWED") : git.clean ? "WORKTREE CLEAN" : "OWNER ACCEPTED";
  const repoLabel = pr?.number ? `${manifest.repo} · PR #${pr.number}` : manifest.repo;
  const fileStat = pr?.changedFiles != null ? `${pr.changedFiles} FILES` : `${manifest.tasks.length} TASKS`;
  const deltaStat = pr?.additions != null ? `+${pr.additions.toLocaleString()} / −${pr.deletions.toLocaleString()}` : `${messageCount} SENDS`;
  const commitStat = pr?.commits != null ? `${pr.commits} COMMITS` : `${spawnEdges.length} SPAWNS`;
  const footerHead = pr?.head || git.head || "LOCAL RUN";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#EAE7DF" stroke-opacity="0.025" stroke-width="1" />
    </pattern>
    <marker id="spawn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#CC785C" />
    </marker>
    <style>
      .mono { font-family: Menlo, monospace; }
      .display { font-family: "Helvetica Neue", Arial, sans-serif; font-stretch: condensed; }
      .hairline { stroke: #EAE7DF; stroke-opacity: .22; stroke-width: 1; }
      .kicker { font-family: Menlo, monospace; font-size: 18px; font-weight: 700; letter-spacing: 2px; fill: #EAE7DF; }
      .meta { font-family: Menlo, monospace; font-size: 16px; font-weight: 400; letter-spacing: 1.5px; fill: #A9A39A; }
      .live { fill: #9ACA86; }
      .headline { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 102px; font-weight: 900; letter-spacing: -5px; fill: #EAE7DF; }
      .headline-accent { fill: #CC785C; }
      .metric { font-family: Menlo, monospace; font-size: 20px; font-weight: 700; fill: #EAE7DF; }
      .metric-muted { font-family: Menlo, monospace; font-size: 17px; font-weight: 400; fill: #A9A39A; }
      .section { font-family: Menlo, monospace; font-size: 15px; font-weight: 500; letter-spacing: 3px; fill: #A9A39A; }
      .node { fill: #1A1917; stroke: #EAE7DF; stroke-opacity: .28; }
      .owner-node { fill: #1A1917; stroke: #CC785C; stroke-width: 2; }
      .node-role { font-family: Menlo, monospace; font-size: 13px; font-weight: 600; letter-spacing: 2px; fill: #9ACA86; }
      .owner-role { fill: #CC785C; }
      .node-title { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 22px; font-weight: 800; fill: #EAE7DF; }
      .node-meta { font-family: Menlo, monospace; font-size: 12px; font-weight: 400; fill: #A9A39A; }
      .spawn { fill: none; stroke: #CC785C; stroke-width: 3; stroke-opacity: .88; }
      .handoff-index { font-family: Menlo, monospace; font-size: 13px; font-weight: 700; fill: #9ACA86; }
      .handoff-route { font-family: Menlo, monospace; font-size: 14px; font-weight: 600; fill: #EAE7DF; }
      .handoff-copy { font-family: Menlo, monospace; font-size: 13px; font-weight: 400; fill: #A9A39A; }
      .outcome-label { font-family: Menlo, monospace; font-size: 14px; font-weight: 600; letter-spacing: 3px; fill: #CC785C; }
      .outcome { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 39px; font-weight: 800; letter-spacing: -1px; fill: #EAE7DF; }
      .proof-big { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 54px; font-weight: 900; letter-spacing: -2px; }
      .proof-small { font-family: Menlo, monospace; font-size: 14px; font-weight: 500; letter-spacing: 2px; }
      .stat-big { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 22px; font-weight: 800; fill: #EAE7DF; }
      .stat-green { fill: #9ACA86; }
      .stat-small { font-family: Menlo, monospace; font-size: 12px; font-weight: 400; letter-spacing: 1.5px; fill: #A9A39A; }
      .footer { font-family: Menlo, monospace; font-size: 13px; font-weight: 500; letter-spacing: 1.3px; fill: #A9A39A; }
      .brand { fill: #EAE7DF; font-weight: 700; }
      .brand-accent { fill: #CC785C; }
    </style>
  </defs>

  <rect width="1200" height="1500" fill="#141413" />
  <rect width="1200" height="1500" fill="url(#grid)" />
  <rect x="28" y="28" width="1144" height="1444" fill="none" stroke="#CC785C" stroke-opacity=".48" />
  <path d="M 28 112 V 28 H 112" fill="none" stroke="#CC785C" stroke-width="4" />

  <text x="68" y="76" class="kicker">${xml(repoLabel.toUpperCase())}</text>
  <circle cx="899" cy="69" r="6" fill="#9ACA86" />
  <text x="920" y="76" class="meta live">AGENT RUN RECEIPT</text>
  <line x1="68" y1="104" x2="1132" y2="104" class="hairline" />

  ${tspans(headline, 68, 218, 95, 'class="headline"')}
  <text x="68" y="${240 + headline.length * 95}" class="metric">1</text>
  <text x="88" y="${240 + headline.length * 95}" class="metric-muted"> owner</text>
  <text x="178" y="${240 + headline.length * 95}" class="metric" fill="#CC785C">/</text>
  <text x="205" y="${240 + headline.length * 95}" class="metric">${workers.length}</text>
  <text x="229" y="${240 + headline.length * 95}" class="metric-muted"> agents</text>
  <text x="340" y="${240 + headline.length * 95}" class="metric" fill="#CC785C">/</text>
  <text x="367" y="${240 + headline.length * 95}" class="metric">${spawnEdges.length}</text>
  <text x="391" y="${240 + headline.length * 95}" class="metric-muted"> spawns</text>
  <text x="503" y="${240 + headline.length * 95}" class="metric" fill="#CC785C">/</text>
  <text x="530" y="${240 + headline.length * 95}" class="metric">${messageCount}</text>
  <text x="564" y="${240 + headline.length * 95}" class="metric-muted"> sends</text>
  <text x="657" y="${240 + headline.length * 95}" class="metric" fill="#CC785C">/</text>
  <text x="684" y="${240 + headline.length * 95}" class="metric">${batches}</text>
  <text x="708" y="${240 + headline.length * 95}" class="metric-muted"> batches</text>

  <line x1="68" y1="444" x2="1132" y2="444" class="hairline" />
  <text x="68" y="480" class="section">THE TEAM THAT BUILT IT</text>
  <rect x="390" y="514" width="420" height="112" class="owner-node" />
  <text x="410" y="541" class="node-role owner-role">OWNER · ROOT</text>
  ${tspans(ownerTitle, 410, 576, 24, 'class="node-title"')}
  <text x="410" y="616" class="node-meta">${xml(`${owner.vendor} · final coordinator`)}</text>
  ${lines}
  ${positions.map((position, index) => taskNode(position.task, position.x, position.y, position.width, index, position.overflow)).join("")}

  <line x1="68" y1="982" x2="1132" y2="982" class="hairline" />
  <text x="68" y="1012" class="section">CONFIRMED HANDOFFS · ${messageEdges.length} EDGES</text>
  ${handoffs || '<text x="68" y="1054" class="handoff-copy">No confirmed Rove peer sends were recorded for the selected tasks.</text>'}

  <line x1="68" y1="1205" x2="1132" y2="1205" class="hairline" />
  <text x="68" y="1240" class="outcome-label">OUTCOME</text>
  ${tspans(outcome, 68, 1283, 42, 'class="outcome"')}

  <g transform="translate(850 1232) rotate(-3 140 63)">
    <rect x="0" y="0" width="280" height="126" fill="none" stroke="${proofColor}" stroke-width="3" />
    <rect x="6" y="6" width="268" height="114" fill="none" stroke="${proofColor}" stroke-opacity=".55" />
    <text x="140" y="60" text-anchor="middle" class="proof-big" fill="${proofColor}">${xml(checks)}</text>
    <text x="140" y="89" text-anchor="middle" class="proof-small" fill="${proofColor}">${xml(proofLabel)}</text>
  </g>

  <line x1="68" y1="1376" x2="1132" y2="1376" class="hairline" />
  <text x="68" y="1408" class="stat-big">${xml(fileStat)}</text>
  <text x="68" y="1430" class="stat-small">CHANGED</text>
  <line x1="268" y1="1392" x2="268" y2="1434" class="hairline" />
  <text x="298" y="1408" class="stat-big stat-green">${xml(deltaStat)}</text>
  <text x="298" y="1430" class="stat-small">CODE DELTA</text>
  <line x1="565" y1="1392" x2="565" y2="1434" class="hairline" />
  <text x="595" y="1408" class="stat-big">${xml(commitStat)}</text>
  <text x="595" y="1430" class="stat-small">COORDINATED RUN</text>
  <text x="68" y="1458" class="footer">${xml(String(footerHead).toUpperCase())} · PUBLIC-SAFE: ${manifest.privacy?.messagePreviewsIncluded ? "REVIEWED PREVIEWS" : "NO MESSAGE TEXT"}</text>
  <text x="1132" y="1458" text-anchor="end" class="footer brand">BUILT WITH <tspan class="brand-accent">ROVE</tspan></text>
</svg>`;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage());
  process.exit(0);
}
if (!args.input) throw new Error(`--input is required\n\n${usage()}`);

const input = resolve(args.input);
const outputDir = resolve(args["output-dir"] || dirname(input));
mkdirSync(outputDir, { recursive: true });
const manifest = JSON.parse(readFileSync(input, "utf8"));
const svgPath = resolve(outputDir, "agent-run-receipt.svg");
const pngPath = resolve(outputDir, "agent-run-receipt.png");
writeFileSync(svgPath, render(manifest));

const conversion = spawnSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const pngReady = conversion.status === 0;
process.stdout.write(`${JSON.stringify({ ok: true, svgPath, pngPath: pngReady ? pngPath : null, pngError: pngReady ? null : conversion.stderr.trim() })}\n`);
