#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

function usage() {
  return `Usage:
  bun collect.mjs --owner-task-id ID --task-ids ID,ID --outcome TEXT --output FILE

Required:
  --owner-task-id ID       Rove task that owns the final report
  --task-ids ID,ID         Explicit run boundary, including the owner
  --outcome TEXT           One factual sentence describing the delivered outcome
  --output FILE            Destination run.json

Optional:
  --headline TEXT          Override the default single-frame hook
  --include-message-previews
                           Include bounded first-send previews after privacy review
  --allow-offline-owner    Permit owner ID != ROVE_TASK_ID for testing
  --demo                   Write a deterministic demo manifest without calling Rove
`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (["include-message-previews", "allow-offline-owner", "demo", "help"].includes(key)) {
      result[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function runJson(command, args, cwd, optional = false) {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (optional) return null;
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function compactVendor(value) {
  return typeof value === "string" && value.trim() ? value.trim().split(/\s+/)[0] : "agent";
}

function sameRepo(left, right) {
  const normalize = (value) => resolve(String(value || ".")).replace(/\/+$/, "");
  return normalize(left) === normalize(right);
}

function checkConclusion(item) {
  if (item.__typename === "StatusContext") return item.state;
  return item.conclusion || item.status;
}

function githubEvidence(cwd) {
  const pr = runJson(
    "gh",
    [
      "pr",
      "view",
      "--json",
      "number,title,url,additions,deletions,changedFiles,commits,statusCheckRollup,headRefOid,mergeStateStatus",
    ],
    cwd,
    true,
  );
  if (!pr) return null;
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const passing = checks.filter((item) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(checkConclusion(item))).length;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commits: Array.isArray(pr.commits) ? pr.commits.length : 0,
    checks: { passing, total: checks.length },
    head: typeof pr.headRefOid === "string" ? pr.headRefOid.slice(0, 8) : null,
    mergeState: pr.mergeStateStatus || null,
  };
}

function gitEvidence(cwd) {
  const text = (args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  return {
    branch: text(["branch", "--show-current"]) || null,
    head: text(["rev-parse", "--short=8", "HEAD"]) || null,
    clean: text(["status", "--porcelain"]) === "",
  };
}

function demoManifest(outcome, headline) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-22T22:00:00.000Z",
    headline: headline || "THIS PULL REQUEST HAD AN ORG CHART.",
    outcome: outcome || "The release gate is clear; the owner can publish.",
    privacy: { messagePreviewsIncluded: false },
    repo: "Sma1lboy/rove",
    owner: { id: "root", title: "Coordinate the release", vendor: "codex", status: "done" },
    tasks: [
      { id: "root", title: "Coordinate the release", vendor: "codex", status: "done", createdAt: "2026-08-22T20:00:00Z" },
      { id: "keyboard", title: "Verify keyboard navigation", vendor: "copilot", status: "done", createdAt: "2026-08-22T20:01:00Z" },
      { id: "graph", title: "Build graph projection", vendor: "codex", status: "done", createdAt: "2026-08-22T20:02:00Z" },
      { id: "api", title: "Audit the API contract", vendor: "claude", status: "done", createdAt: "2026-08-22T20:03:00Z" },
    ],
    edges: [
      { kind: "spawn", from: "root", to: "keyboard" },
      { kind: "spawn", from: "root", to: "graph" },
      { kind: "spawn", from: "root", to: "api" },
      { kind: "message", from: "keyboard", to: "graph", count: 1 },
      { kind: "message", from: "graph", to: "api", count: 2 },
      { kind: "message", from: "api", to: "root", count: 1 },
    ],
    batches: [{ id: "release", taskIds: ["keyboard", "graph", "api"] }],
    evidence: {
      pr: { number: 501, changedFiles: 59, additions: 2018, deletions: 47, commits: 11, checks: { passing: 10, total: 10 }, head: "c4dea0fe" },
      git: { branch: "feat/agent-tree-panel", head: "c4dea0fe", clean: true },
    },
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage());
  process.exit(0);
}

if (!args.output) throw new Error(`--output is required\n\n${usage()}`);
if (!args.outcome && !args.demo) throw new Error(`--outcome is required\n\n${usage()}`);

let manifest;
if (args.demo) {
  manifest = demoManifest(args.outcome, args.headline);
} else {
  const ownerTaskId = args["owner-task-id"] || process.env.ROVE_TASK_ID;
  if (!ownerTaskId) throw new Error("--owner-task-id is required outside a Rove task");
  if (process.env.ROVE_TASK_ID && process.env.ROVE_TASK_ID !== ownerTaskId && !args["allow-offline-owner"]) {
    throw new Error(`current Rove task ${process.env.ROVE_TASK_ID} is not owner ${ownerTaskId}`);
  }
  const selectedIds = [...new Set(String(args["task-ids"] || "").split(",").map((id) => id.trim()).filter(Boolean))];
  if (!selectedIds.length) throw new Error("--task-ids must explicitly define this run");
  if (!selectedIds.includes(ownerTaskId)) selectedIds.unshift(ownerTaskId);

  const snapshots = selectedIds.map((id) => runJson("rove", ["api", "get-task", "--task-id", id], process.cwd()));
  const ownerSnapshot = snapshots.find((snapshot) => snapshot.task?.id === ownerTaskId);
  if (!ownerSnapshot?.task) throw new Error(`owner task ${ownerTaskId} was not returned by Rove`);
  if (ownerSnapshot.task.dispatcher && !args["allow-offline-owner"]) {
    throw new Error(`task ${ownerTaskId} has a dispatcher; report to that owner instead of generating the parent receipt`);
  }
  for (const snapshot of snapshots) {
    if (!sameRepo(snapshot.task?.repo, ownerSnapshot.task.repo)) {
      throw new Error(`selected task ${snapshot.task?.id || "unknown"} belongs to a different repository`);
    }
  }
  if (snapshots.length < 2) throw new Error("no worker tasks selected; skip the multi-agent receipt");

  const selected = new Set(selectedIds);
  const tasks = snapshots
    .map(({ task }) => ({
      id: String(task.id),
      title: task.title || "Untitled task",
      vendor: compactVendor(task.vendor),
      status: task.status || "unknown",
      createdAt: task.createdAt || null,
      groupId: task.groupId || null,
      dispatcherId: task.dispatcher?.taskId || null,
    }))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));

  const edges = [];
  for (const { task } of snapshots) {
    const childId = String(task.id);
    const parentId = task.dispatcher?.taskId;
    if (parentId && selected.has(parentId)) edges.push({ kind: "spawn", from: parentId, to: childId });
    for (const communication of task.communications || []) {
      if (!selected.has(communication.targetTaskId)) continue;
      edges.push({
        kind: "message",
        from: childId,
        to: communication.targetTaskId,
        count: Number(communication.count) || 1,
        ...(args["include-message-previews"] && communication.firstMessagePreview
          ? { preview: communication.firstMessagePreview }
          : {}),
      });
    }
  }

  const batchesById = new Map();
  for (const task of tasks) {
    if (!task.groupId) continue;
    const members = batchesById.get(task.groupId) || [];
    members.push(task.id);
    batchesById.set(task.groupId, members);
  }

  const cwd = ownerSnapshot.task.worktreePath || ownerSnapshot.task.repo || process.cwd();
  const pr = githubEvidence(cwd);
  manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    headline: args.headline || (pr ? "THIS PULL REQUEST HAD AN ORG CHART." : "THIS TASK HAD AN ORG CHART."),
    outcome: args.outcome,
    privacy: { messagePreviewsIncluded: Boolean(args["include-message-previews"]) },
    repo: basename(resolve(ownerSnapshot.task.repo || cwd)),
    owner: tasks.find((task) => task.id === ownerTaskId),
    tasks,
    edges,
    batches: [...batchesById].map(([id, taskIds]) => ({ id, taskIds })),
    evidence: { pr, git: gitEvidence(cwd) },
  };
}

const output = resolve(args.output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, output, tasks: manifest.tasks.length, edges: manifest.edges.length })}\n`);
