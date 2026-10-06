// A canned-answer bridge on :7896 (token "fixture") to look at states the sandbox cannot
// produce: stale daemon, warn/ok quota meters, plugins, GitHub issues, all routine run tones,
// a need-you card floating on the board. bun packages/rove-ios/scripts/fixture-bridge.ts  (then TEST_RUNNER_ROVE_FIXTURE_URL=ws://127.0.0.1:7896/?token=fixture)
const REPO = "/work/payments-api"
const task = (id: string, title: string, group: string, rank: number, extra: object = {}) => ({
  id, title, branch: `b-${id}`, repo: REPO, kind: "task", status: "in-progress", group, rank,
  activity: { state: group === "working" ? "running" : "waiting", forMs: 120000 },
  engine: { id: "codex", name: "Codex" }, pr: null, report: null, deleting: false, ...extra,
})
const tasks = [
  task("T-WAIT", "Verify refund webhook signatures", "waiting-on-you", 0),
  task("T-WORK", "Add pagination to invoices", "working", 3),
  task("T-LAND", "Retry failed charges", "landing", 1),
]
const stories = [
  { id: 9, title: "Rate limit the refund endpoint", status: "open", created: "2026-10-05", body: "Token bucket per api key.\nCap at 10 rpm." },
  { id: 8, title: "Webhook signature checks", status: "doing", created: "2026-10-04", body: "HMAC-SHA256 with timingSafeEqual.", taskId: "T-WAIT" },
  { id: 7, title: "Invoice pagination", status: "open", created: "2026-10-03", body: "Cursor based.", taskId: "T-WORK" },
  { id: 6, title: "Retry charges on 5xx", status: "doing", created: "2026-10-03", body: "", taskId: "T-LAND" },
  { id: 5, title: "Move to the new ledger", status: "hold", created: "2026-10-01", body: "Blocked on infra." },
  { id: 4, title: "Drop the legacy sandbox flag", status: "done", created: "2026-09-30", body: "" },
  { id: 3, title: "Audit log export", status: "open", created: "2026-09-29", body: "CSV for finance." },
]
const iso = (min: number) => new Date(Date.now() + min * 60000).toISOString()
const routine = (id: string, name: string, schedule: string, enabled = true, extra: object = {}) => ({
  id, name, repo: REPO, prompt: `Run the ${name} checks and report anything surprising.`, schedule, enabled,
  nextRunAt: iso(60 * 20), missedRunGraceMinutes: 60, persistentSession: false, ...extra,
})
const routines = [
  routine("r-ok", "nightly dependency audit", "0 3 * * *"),
  routine("r-skip", "docs link check", "0 9 * * MON-FRI", true, { precheck: { command: "git diff --quiet origin/main -- docs", timeoutSeconds: 60 } }),
  routine("r-miss", "weekly changelog digest", "0 8 * * MON", true, { baseRef: "main" }),
  routine("r-bad", "flaky test hunter", "*/30 * * * *"),
  routine("r-off", "stale branch sweep", "0 6 * * SUN", false),
]
const runs = [
  { id: "x4", automationId: "r-ok", runNumber: 4, status: "dispatched", trigger: "scheduled", at: iso(-60 * 5), taskId: "T-WORK", tabId: "tab-1",
    response: { text: "Audited 41 packages.\n\n- 2 minor bumps available\n- no advisories", at: iso(-60 * 4) } },
  { id: "x3", automationId: "r-ok", runNumber: 3, status: "skipped_precheck", trigger: "scheduled", at: iso(-60 * 29) },
  { id: "x2", automationId: "r-ok", runNumber: 2, status: "skipped_missed", trigger: "scheduled", at: iso(-60 * 53) },
  { id: "x1", automationId: "r-ok", runNumber: 1, status: "dispatch_failed", trigger: "manual", at: iso(-60 * 77), error: "engine binary not found on PATH" },
]
const answers: Record<string, unknown> = {
  hello: { protocol: 1, roveVersion: "0.9.240", host: "fixture-mac" },
  "tasks.subscribe": { tasks, attention: [] },
  "tasks.list": { tasks, attention: [] },
  "repos.list": { repos: [REPO, "/work/marketing-site"] },
  "engines.list": { engines: [
    { id: "claude", name: "Claude", command: "claude", protocol: "claude", builtin: true },
    { id: "codex", name: "Codex", command: "codex", protocol: "codex", builtin: true },
    { id: "mine", name: "My Local Agent", command: "mine", protocol: "generic", builtin: false },
  ] },
  "task.tabs": { tabs: [] },
  "issue.repos": { repos: [REPO] },
  "issue.list": { repoRoot: REPO, exists: true, nextId: 10, issues: stories, skipped: 0 },
  "task.events": { events: [
    { kind: "turn-complete", at: Date.now() - 4 * 60000, tail: "codex" },
    { kind: "tool-start", at: Date.now() - 9 * 60000, tail: "Bash · codex" },
    { kind: "turn-start", at: Date.now() - 11 * 60000, tail: "codex" },
    { kind: "session-start", at: Date.now() - 12 * 60000, tail: "codex" },
  ] },
  "routine.list": { automations: routines, lastRunStatus: { "r-ok": "dispatched", "r-skip": "skipped_precheck", "r-miss": "skipped_missed", "r-bad": "dispatch_failed" }, keepsDaemonAlive: true },
  "routine.runs": { runs },
  "workitem.list": { items: [
    { provider: "github", type: "issue", number: 214, title: "Refund webhook retries forever on 410", state: "open", url: "https://github.com/acme/payments-api/issues/214", updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(), author: "ana", labels: ["bug", "p1", "webhooks"] },
    { provider: "github", type: "issue", number: 212, title: "Paginate the invoices list", state: "open", url: "https://github.com/acme/payments-api/issues/212", updatedAt: new Date(Date.now() - 3600000 * 5).toISOString(), author: "ben", labels: ["enhancement"] },
    { provider: "github", type: "issue", number: 209, title: "Docs: explain idempotency keys", state: "open", url: "https://github.com/acme/payments-api/issues/209", updatedAt: new Date(Date.now() - 86400000 * 9).toISOString(), labels: [] },
  ] },
  "workitem.links": { links: [{ number: 212, taskId: "T-WORK" }] },
  "usage.get": { usage: [
    { vendor: "claude", name: "Claude", capturedAt: Date.now() - 120000, windows: [
      { kind: "session", label: "5h", percent: 42, resetsAt: Date.now() + 3600000 * 2 },
      { kind: "week", label: "7d", percent: 81, resetsAt: Date.now() + 3600000 * 70 } ] },
    { vendor: "codex", name: "Codex", capturedAt: Date.now() - 400000, windows: [
      { kind: "primary", label: "7d", percent: 97, resetsAt: Date.now() + 3600000 * 30 } ] },
  ] },
  "daemon.info": { daemonVersion: "0.9.230", bridgeVersion: "0.9.240", stale: true, uptimeMs: 86400000 * 3, startedAt: iso(-60 * 24 * 3), taskCount: 12, attachedClients: 2, automationHold: true },
  "plugins.list": { plugins: [
    { id: "notes", version: "1.2.0", enabled: true, linked: false, platformOk: true, hooksDeclared: true, updateAvailable: true, declares: { actions: 2, events: 1, panes: 0, engines: 0 }, lastRun: { at: Date.now() - 3600000, label: "startup", ok: true, running: false } },
    { id: "gemini-engine", version: "0.4.1", enabled: false, linked: true, platformOk: true, hooksDeclared: false, updateAvailable: false, declares: { actions: 0, events: 0, panes: 0, engines: 1 }, lastRun: null },
    { id: "winonly", version: "0.1.0", enabled: true, linked: false, platformOk: false, hooksDeclared: true, updateAvailable: false, declares: null, lastRun: { at: Date.now() - 86400000, label: "on-task-done", ok: false, running: false } },
  ] },
  "engines.settings": { defaultId: "claude", engines: [
    { id: "claude", name: "Claude", builtin: true, custom: false, enabled: true, isDefault: true, canBeDefault: true, binary: "claude", customized: false, protocol: null, binaryFound: true, binaryPath: "/opt/homebrew/bin/claude", login: "yes", hooks: "installed", markers: true, screen: false },
    { id: "codex", name: "Codex", builtin: true, custom: false, enabled: false, isDefault: false, canBeDefault: true, binary: "codex", customized: true, protocol: null, binaryFound: true, binaryPath: "/opt/homebrew/bin/codex", login: "no", hooks: "outdated", markers: true, screen: false },
    { id: "mine", name: "My Local Agent", builtin: false, custom: true, enabled: true, isDefault: false, canBeDefault: true, binary: "/opt/mine/agent", customized: true, protocol: "claude", binaryFound: false, binaryPath: null, login: "unknown", hooks: "unsupported", markers: false, screen: false, configIssue: "hook file is read-only" },
  ] },
  "repo.digest": { repo: REPO, since: iso(-60 * 24 * 7), tasks: { total: 9 }, routines: { runs: 14, byStatus: { dispatched: 9, skipped_precheck: 3, dispatch_failed: 1, skipped_missed: 1 } } },
  "turns.list": { since: iso(-60 * 24 * 7), totals: { turns: 31, inputTokens: 482113, outputTokens: 61220, cacheReadTokens: 9120344, cacheCreationTokens: 0, durationMs: 4380000, byModel: { "gpt-6-astra": 22, fable: 9 } },
    turns: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, taskId: "T-WORK", vendor: i % 2 ? "claude" : "codex", model: i % 2 ? "fable" : "gpt-6-astra", startedAt: Date.now() - (i + 1) * 900000, endedAt: Date.now() - (i + 1) * 900000 + 140000 + i * 20000 })) },
}
Bun.serve({
  port: 7896,
  fetch(req, server) {
    if (req.headers.get("authorization") !== "Bearer fixture") return new Response("no", { status: 401 })
    return server.upgrade(req) ? undefined : new Response("ws", { status: 426 })
  },
  websocket: {
    message(ws, raw) {
      const { id, op } = JSON.parse(String(raw))
      const result = answers[op] ?? {}
      ws.send(JSON.stringify({ id, ok: true, result }))
    },
  },
})
console.log("fixture bridge on :7896")
