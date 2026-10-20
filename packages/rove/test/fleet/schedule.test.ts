import { describe, expect, it } from "vitest"
import type { NodeStatus } from "../../src/fleet/node-status.ts"
import { normalizeRemoteUrl } from "../../src/fleet/repo-remote.ts"
import { askRouter } from "../../src/fleet/router.ts"
import { type Candidate, pickNode } from "../../src/fleet/schedule.ts"

const REMOTE = "github.com/acme/app"

function node(over: Partial<NodeStatus> = {}): NodeStatus {
  return {
    hostname: "h",
    version: "0.0.0",
    platform: "linux",
    cpus: 8,
    loadAvg1: 0,
    memFreeRatio: 0.5,
    liveSessions: 0,
    tasks: 0,
    engines: ["claude", "codex"],
    tags: [],
    description: "",
    repos: [{ path: "/srv/app", remote: REMOTE }],
    ...over,
  }
}

const center = (over: Partial<NodeStatus> = {}): Candidate => ({ alias: "local", status: node(over), isCenter: true })
const worker = (alias: string, over: Partial<NodeStatus> = {}): Candidate => ({
  alias,
  status: node(over),
  isCenter: false,
})

describe("pickNode", () => {
  it("sends the task to the freest worker, with that worker's own path to the repo", () => {
    const verdict = pickNode({
      mode: "any",
      centerTakesTasks: false,
      repoRemote: REMOTE,
      candidates: [
        center(),
        worker("a", { liveSessions: 6 }),
        worker("b", { liveSessions: 1, repos: [{ path: "/home/me/app", remote: REMOTE }] }),
      ],
    })
    expect(verdict).toMatchObject({ ok: true, alias: "b", repo: "/home/me/app" })
  })

  it("keeps load off the center while a worker can take the task, and falls back to it when none can", () => {
    const idleCenter = center()
    const busyWorker = worker("a", { liveSessions: 7 })
    expect(pickNode({ mode: "any", centerTakesTasks: false, candidates: [idleCenter, busyWorker] })).toMatchObject({
      alias: "a",
    })
    const capped = worker("a", { liveSessions: 4, maxLiveSessions: 4 })
    const verdict = pickNode({ mode: "any", centerTakesTasks: false, candidates: [idleCenter, capped] })
    expect(verdict).toMatchObject({
      ok: true,
      alias: "local",
      rejected: [{ alias: "a", why: "at its session cap (4)" }],
    })
  })

  it("says why each node was passed over when none can run the task", () => {
    const verdict = pickNode({
      mode: "any",
      centerTakesTasks: true,
      repoRemote: REMOTE,
      engine: "codex",
      candidates: [
        { alias: "gone", status: null, isCenter: false },
        worker("a", { repos: [] }),
        worker("b", { engines: ["claude"] }),
      ],
    })
    expect(verdict).toEqual({
      ok: false,
      rejected: [
        { alias: "gone", why: "did not answer" },
        { alias: "a", why: `has no checkout of ${REMOTE}` },
        { alias: "b", why: "has no codex engine" },
      ],
    })
  })

  it("auto routes a prompt to the worker whose tags it mentions, ahead of a freer one", () => {
    const verdict = pickNode({
      mode: "auto",
      centerTakesTasks: false,
      prompt: "Train the ranking model on the GPU box",
      candidates: [center(), worker("idle"), worker("gpu", { liveSessions: 3, tags: ["gpu", "cuda"] })],
    })
    expect(verdict).toMatchObject({ ok: true, alias: "gpu" })
  })

  it("auto takes a router's pick only when it names an eligible node", () => {
    const candidates = [center(), worker("a"), worker("b", { liveSessions: 2 })]
    expect(pickNode({ mode: "auto", centerTakesTasks: false, routed: "b", candidates })).toMatchObject({ alias: "b" })
    expect(pickNode({ mode: "auto", centerTakesTasks: false, routed: "local", candidates })).toMatchObject({
      alias: "a",
    })
  })
})

describe("normalizeRemoteUrl", () => {
  it("gives the ssh and https spellings of one repo the same identity", () => {
    for (const url of [
      "git@github.com:acme/app.git",
      "ssh://git@github.com:22/acme/app",
      "https://github.com/acme/app.git",
      "https://user@GitHub.com/acme/app/",
    ]) {
      expect(normalizeRemoteUrl(url)).toBe(REMOTE)
    }
    expect(normalizeRemoteUrl("/srv/repos/app.git")).toBeNull()
  })
})

describe("askRouter", () => {
  const nodes = [{ alias: "a", status: node() }]
  const answering = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch

  it("ignores an answer naming a node it was not offered", async () => {
    const ask = (body: unknown) =>
      askRouter({ url: "http://router", timeoutMs: 1000, prompt: "p", nodes, fetchImpl: answering(body) })
    await expect(ask({ node: "a" })).resolves.toBe("a")
    await expect(ask({ node: "z" })).resolves.toBeUndefined()
    await expect(ask("rubbish")).resolves.toBeUndefined()
  })
})
