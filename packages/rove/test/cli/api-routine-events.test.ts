/**
 * CLI contract for event-driven routines: `routine-create` without `--schedule`,
 * `--event` + `--event-*` filter validation, `routine-update` clearing `--schedule ''`
 * or `--event ''`, `routine-list --mode`, and `routine-emit`.
 */

import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import { describe, expect, it } from "vitest"
import { FakeClient, stubRuntime } from "./api-handler-fixtures.ts"

const ok = () => ({ automation: { id: "r1" } })

describe("event-driven routine CLI verbs", () => {
  it("creates a pure event-driven routine without --schedule and forwards filters", async () => {
    const client = new FakeClient({ "automation.create": ok })
    await invokeVerb(
      "routine-create",
      [
        "--repo",
        "/repo",
        "--name",
        "CI watcher",
        "--prompt",
        "Fix red checks",
        "--event",
        "ci_failed,pr_review_requested",
        "--event-branch",
        "release/*",
      ],
      { client, runtime: stubRuntime() },
    )
    expect(client.requests[0]).toEqual({
      name: "automation.create",
      payload: {
        repo: "/repo",
        name: "CI watcher",
        prompt: "Fix red checks",
        eventTriggers: [
          { kind: "ci_failed", filter: { branch: "release/*" } },
          { kind: "pr_review_requested", filter: { branch: "release/*" } },
        ],
      },
    })
  })

  it("refuses routine-create with no trigger and refuses --event-* filters without --event", async () => {
    const client = new FakeClient({ "automation.create": ok })
    await expect(
      invokeVerb("routine-create", ["--repo", "/repo", "--name", "none", "--prompt", "p"], {
        client,
        runtime: stubRuntime(),
      }),
    ).rejects.toThrow(/--schedule, --event, or --webhook/)

    await expect(
      invokeVerb(
        "routine-create",
        ["--repo", "/repo", "--name", "bad", "--prompt", "p", "--schedule", "0 9 * * *", "--event-branch", "main"],
        { client, runtime: stubRuntime() },
      ),
    ).rejects.toThrow(/require --event/)

    await expect(
      invokeVerb("routine-create", ["--repo", "/repo", "--name", "bad", "--prompt", "p", "--event", "not_a_kind"], {
        client,
        runtime: stubRuntime(),
      }),
    ).rejects.toThrow(/must be one of/)
  })

  it("clears schedule or eventTriggers via empty strings on routine-update", async () => {
    const client = new FakeClient({ "automation.update": ok })
    await invokeVerb("routine-update", ["--id", "r1", "--schedule", "", "--event", "local", "--event-name", "deploy"], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[0]).toEqual({
      name: "automation.update",
      payload: {
        id: "r1",
        schedule: null,
        eventTriggers: [{ kind: "local", filter: { event: "deploy" } }],
      },
    })

    await invokeVerb("routine-update", ["--id", "r1", "--event", ""], {
      client,
      runtime: stubRuntime(),
    })
    expect(client.requests[1]?.payload).toMatchObject({ id: "r1", eventTriggers: null })
  })

  it("forwards --mode on routine-list and dispatches routine-emit", async () => {
    const client = new FakeClient({
      "automation.list": () => ({ automations: [], keepsDaemonAlive: false }),
      "automation.emitEvent": () => ({
        matched: 1,
        fired: [{ automationId: "r1", name: "hook", status: "dispatched" }],
      }),
    })
    await invokeVerb("routine-list", ["--mode", "event"], { client, runtime: stubRuntime() })
    expect(client.requests[0]).toEqual({ name: "automation.list", payload: { mode: "event" } })

    await invokeVerb(
      "routine-emit",
      ["--repo", "/repo", "--event", "deploy.finished", "--branch", "main", "--detail", "v1.0"],
      { client, runtime: stubRuntime() },
    )
    expect(client.requests[1]).toEqual({
      name: "automation.emitEvent",
      payload: {
        event: "deploy.finished",
        repo: "/repo",
        branch: "main",
        detail: "v1.0",
      },
    })
  })
})
