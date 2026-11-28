/**
 * A workspace package reaches another only through its package name, never a
 * relative path (`../other-package/…`): the name keeps the boundary real and
 * survives a directory move. Files listed in KNOWN predate the rule; the list
 * only shrinks.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url))
const NAMES = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const KNOWN = new Set<string>([
  "rove-daemon/src/client/daemon-process.ts",
  "rove-harness/test/server-session.test.ts",
  "rove-harness/test/web-page-selection.test.tsx",
  "rove-plugin-sdk/test/contract.test.ts",
  "rove-web/src/demo/transport.ts",
  "rove-web/src/wall/icons.ts",
  "rove/test/architecture/tab-activity-isolation.test.ts",
  "rove/test/behavior/plugin-process/native.mjs",
  "rove/test/cli/api-mod-gate.test.ts",
  "rove/test/cli/dispatch-hook-inbox.test.ts",
  "rove/test/cli/engine-admission.test.ts",
  "rove/test/client/detached-spawn-platform.test.ts",
  "rove/test/client/pty-frozen-sessions.test.ts",
  "rove/test/client/win-detached-launch.test.ts",
  "rove/test/client/win-pty-job.test.ts",
  "rove/test/daemon/activity-observer-shutdown.test.ts",
  "rove/test/daemon/alias-keeper.test.ts",
  "rove/test/daemon/aliased-pty-ownership.test.ts",
  "rove/test/daemon/automation-bound-delivery.test.ts",
  "rove/test/daemon/automation-precheck.test.ts",
  "rove/test/daemon/automation-repo-check.test.ts",
  "rove/test/daemon/automation-responses.test.ts",
  "rove/test/daemon/automation-runner-fixtures.ts",
  "rove/test/daemon/automation-runner-honesty.test.ts",
  "rove/test/daemon/automation-runner.test.ts",
  "rove/test/daemon/automation-standing-pins.test.ts",
  "rove/test/daemon/automation-standing-session.test.ts",
  "rove/test/daemon/automation-target-api.test.ts",
  "rove/test/daemon/automations-roundtrip-fields.test.ts",
  "rove/test/daemon/automations-store.test.ts",
  "rove/test/daemon/backpressure-reconnect.test.ts",
  "rove/test/daemon/channel-backpressure.test.ts",
  "rove/test/daemon/cron-dst.test.ts",
  "rove/test/daemon/cron.test.ts",
  "rove/test/daemon/deliveries.test.ts",
  "rove/test/daemon/delivery-report-notice.test.ts",
  "rove/test/daemon/engine-tab-migration.test.ts",
  "rove/test/daemon/gates.test.ts",
  "rove/test/daemon/home-owner.test.ts",
  "rove/test/daemon/json-file.test.ts",
  "rove/test/daemon/legacy-adopted.test.ts",
  "rove/test/daemon/line-receiver.test.ts",
  "rove/test/daemon/low-disk-watch.test.ts",
  "rove/test/daemon/pending-starts.test.ts",
  "rove/test/daemon/program-status-stream.test.ts",
  "rove/test/daemon/prompt-queue.test.ts",
  "rove/test/daemon/quota-resume-now.test.ts",
  "rove/test/daemon/quota-resume.test.ts",
  "rove/test/daemon/quota-usage-cache.test.ts",
  "rove/test/daemon/routine-engine-launch.test.ts",
  "rove/test/daemon/routine-last-failure.test.ts",
  "rove/test/daemon/routine-no-project.test.ts",
  "rove/test/daemon/routine-prompt-elision.test.ts",
  "rove/test/daemon/routine-quiet-turn.test.ts",
  "rove/test/daemon/routine-webhook.test.ts",
  "rove/test/daemon/runnability-schedulers.test.ts",
  "rove/test/daemon/runnability.test.ts",
  "rove/test/daemon/scheduled-start.test.ts",
  "rove/test/daemon/task-deletion-audit.test.ts",
  "rove/test/daemon/task-deletion-runner.test.ts",
  "rove/test/daemon/work-items.test.ts",
  "rove/test/engine/activity-osc.test.ts",
  "rove/test/engine/chat-transcript-shape.test.ts",
  "rove/test/engine/osc-signals.test.ts",
  "rove/test/engine/plugin-engines.test.ts",
  "rove/test/lib/windows-path-consumers.test.ts",
  "rove/test/orchestrator/multi-repo-land.test.ts",
  "rove/test/plugins/example-plugins.test.ts",
  "rove/test/plugins/process-platform.test.ts",
])

function sources(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sources(full, acc)
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function crossers(): string[] {
  return NAMES.flatMap((own) => {
    const other = NAMES.filter((name) => name !== own).join("|")
    const crossing = new RegExp(`["'\`](?:\\.\\./)+(?:${other})/`)
    return ["src", "test"]
      .flatMap((dir) => sources(join(PACKAGES, own, dir)))
      .filter((file) => crossing.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(PACKAGES.length))
  })
}

test("no package reaches another workspace package by relative path", () => {
  expect(crossers().filter((file) => !KNOWN.has(file))).toEqual([])
})

test("every KNOWN entry still crosses, so the list only shrinks", () => {
  const now = new Set(crossers())
  expect([...KNOWN].filter((file) => !now.has(file))).toEqual([])
})
