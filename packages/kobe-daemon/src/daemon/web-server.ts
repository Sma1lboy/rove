/**
 * Daemon-hosted local HTTP/SSE transport for kobe web and desktop.
 */

import { existsSync } from "node:fs"
import { join, normalize } from "node:path"
import type { DaemonRpcClient } from "../client/rpc.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import type { ChannelEvent, DaemonEventBus } from "./event-bus.ts"
import {
  type DaemonHandlerContext,
  createDaemonHandlerRegistry,
  dispatchDaemonRequest,
  shapeDaemonError,
  webExposedRpcNames,
} from "./handlers.ts"
import { defaultWebTokenPath } from "./paths.ts"
import type { ChannelName, ChannelPayloads, DaemonRequestName, SerializedTask } from "./protocol.ts"
import { serializeTask } from "./protocol.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { handleIssueAssetsRequest } from "./web-issue-assets-route.ts"
import { handleIssuesRequest } from "./web-issues-route.ts"
import { allowedHostForBindHost, originAllowed } from "./web-origin.ts"
import { engineSpec, ensureTaskSession, tearDownTaskSession, terminalSpec } from "./web-session.ts"
import { settingsPatch, settingsSnapshot } from "./web-settings.ts"
import { ensureWebToken, presentedToken, requiresWebToken, tokensMatch } from "./web-token.ts"
import { handleWorktreesRequest } from "./web-worktrees-route.ts"

export const DAEMON_WEB_HEALTH_MARKER = "kobe-web"
export const DAEMON_WEB_HEALTH_PATH = "/__kobe_web"

type SseSend = (type: string, data: unknown) => void

export interface DaemonWebSnapshotState {
  tasks: SerializedTask[]
  activeTaskId: string | null
  engineStates: Record<string, ChannelPayloads["engine-state"]>
  update: ChannelPayloads["update"]["info"]
  jobs: Record<string, ChannelPayloads["task.jobs"]>
  worktreeChanges: ChannelPayloads["worktree.changes"]["changes"]
  issueSnapshots: Record<string, ChannelPayloads["issue.snapshot"]>
  deliver: ChannelPayloads["session.deliver"] | null
  uiPrefs: ChannelPayloads["ui-prefs"] | null
  connected: boolean
}

export interface DaemonWebLink extends DaemonRpcClient {
  snapshot(): DaemonWebSnapshotState
}

export interface RequestHandlerDeps {
  runtime: DaemonRuntimeAdapter
  link: DaemonWebLink
  sseSends: Set<SseSend>
  staticDir?: string
  tearDownSession?: (taskId: string) => void
  allowedHost?: string
  onSseOpen?: () => () => void
  /** Shared secret every request must present. Omitted only by tests that
   *  exercise unrelated routing; production always supplies one. */
  webToken?: string
}

export interface DaemonWebServerOptions {
  runtime: DaemonRuntimeAdapter
  port: number
  hostname?: string
  staticDir?: string
  takeover?: boolean
  link: DaemonWebLink
  onEvent: (sink: (event: ChannelEvent) => void) => () => void
  onSseOpen?: () => () => void
  /** Override the minted token (tests). Production lets it come from disk. */
  webToken?: string
  /** Override the token file location (tests / sandboxed homes). */
  webTokenPath?: string
}

export interface DaemonWebServer {
  readonly port: number
  readonly hostname: string
  close(): void
}

function sseResponse(register: (send: SseSend) => () => void, signal?: AbortSignal): Response {
  let unregister: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  // Teardown must not depend on Bun calling cancel(): a half-open disconnect
  // (sleep, dropped Wi-Fi, killed browser) can skip it, leaving a phantom
  // client that pins guiCount > 0 and keeps every collector polling forever.
  // Idempotent cleanup, reachable from cancel(), the request's abort signal,
  // AND a failed heartbeat write — whichever fires first.
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    if (heartbeat) clearInterval(heartbeat)
    unregister?.()
  }
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send: SseSend = (type, data) => {
        try {
          controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          /* stream already closed — the next heartbeat tears down */
        }
      }
      unregister = register(send)
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"))
        } catch {
          cleanup()
        }
      }, 15_000)
      if (signal?.aborted) cleanup()
      else signal?.addEventListener("abort", cleanup, { once: true })
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}

// Exposure policy comes FROM the handler registry (`web: true` per entry) —
// no separately maintained allowlist to drift. Registry construction is
// stateless/cheap, so deriving the set once at module load is fine.
// Re-exported from here rather than the usual `server.ts`: this module IS the
// web-exposure boundary, so the name every caller asks "is this reachable from
// a browser?" through should come from the file that enforces it.
export { webExposedRpcNames } from "./handlers.ts"
export { requiresWebToken } from "./web-token.ts"
const WEB_EXPOSED_RPCS = webExposedRpcNames(createDaemonHandlerRegistry())

/**
 * Map a thrown error to the HTTP error envelope. The error POLICY (message
 * wording, name propagation) is {@link shapeDaemonError} — the same shaping
 * the socket transport puts in its response frames — so the two transports
 * carry identical fields. Two deliberate HTTP-side differences, both pinned
 * by tests: the message travels under `error` (the SPA's api-client parses
 * `error`, not `message` — packages/kobe-web/src/lib/api-client.ts), and a
 * plain anonymous Error's `name: "Error"` stays off the wire (pinned by
 * kobe-web's bridge-routes test).
 */
export function webRpcErrorBody(err: unknown): { error: string; name?: string } {
  const { message, name } = shapeDaemonError(err)
  return { error: message, ...(name !== undefined && name !== "Error" ? { name } : {}) }
}

function webRpcErrorResponse(err: unknown, status: number): Response {
  return Response.json(webRpcErrorBody(err), { status })
}

async function rpcResponse(req: Request, link: DaemonWebLink, tearDown: (taskId: string) => void): Promise<Response> {
  try {
    const { name, payload } = (await req.json()) as { name?: DaemonRequestName; payload?: unknown }
    if (!name) return Response.json({ error: "missing rpc name" }, { status: 400 })
    if (!WEB_EXPOSED_RPCS.has(name)) {
      return Response.json({ error: `rpc ${name} is not exposed to the web UI` }, { status: 403 })
    }
    const result = await link.request(name, payload)
    const taskId = (payload as { taskId?: unknown } | undefined)?.taskId
    if (typeof taskId === "string" && name === "task.delete") tearDown(taskId)
    return Response.json({ result })
  } catch (err) {
    return webRpcErrorResponse(err, 500)
  }
}

async function enginesResponse(runtime: DaemonRuntimeAdapter): Promise<Response> {
  try {
    const ids = await runtime.availableEngineIds()
    const engines = ids.map((id) => ({
      id,
      label: runtime.engineDisplayName(id),
      effortLevels: runtime.engineEntry(id).effortLevels,
    }))
    // Empty stays empty: the SPA keeps its own four-built-in fallback only
    // when the route yields nothing, and a synthesized entry defeats that.
    return Response.json({ engines })
  } catch (err) {
    return webRpcErrorResponse(err, 500)
  }
}

function cliInvocationResponse(runtime: DaemonRuntimeAdapter): Response {
  return Response.json({ api: runtime.kobeApiInvocation() })
}

function projectsResponse(runtime: DaemonRuntimeAdapter): Response {
  return Response.json({ projects: runtime.getSavedRepos() })
}

async function sessionResponse(runtime: DaemonRuntimeAdapter, req: Request, link: DaemonWebLink): Promise<Response> {
  try {
    const { taskId } = (await req.json()) as { taskId?: string }
    if (!taskId) return Response.json({ error: "missing taskId" }, { status: 400 })
    return Response.json(await ensureTaskSession(runtime, link, taskId))
  } catch (err) {
    return webRpcErrorResponse(err, 500)
  }
}

async function specResponse(
  url: URL,
  link: DaemonWebLink,
  spec: (link: DaemonWebLink, taskId: string) => Promise<{ cwd: string; command: string[]; firstMessage?: string }>,
): Promise<Response> {
  try {
    const taskId = url.searchParams.get("taskId")
    if (!taskId) return Response.json({ error: "missing taskId" }, { status: 400 })
    return Response.json(await spec(link, taskId))
  } catch (err) {
    return webRpcErrorResponse(err, 500)
  }
}

const QUICK_PROMPT_KEYS = {
  review: "boardPrompt.review",
  pr: "boardPrompt.pr",
} as const

function quickPromptsGet(runtime: DaemonRuntimeAdapter): Response {
  return Response.json({
    review: runtime.getPersistedString(QUICK_PROMPT_KEYS.review) ?? null,
    pr: runtime.getPersistedString(QUICK_PROMPT_KEYS.pr) ?? null,
  })
}

async function quickPromptsPut(runtime: DaemonRuntimeAdapter, req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { review?: unknown; pr?: unknown }
    if (typeof body.review === "string") runtime.setPersistedString(QUICK_PROMPT_KEYS.review, body.review)
    if (typeof body.pr === "string") runtime.setPersistedString(QUICK_PROMPT_KEYS.pr, body.pr)
    return quickPromptsGet(runtime)
  } catch (err) {
    return webRpcErrorResponse(err, 400)
  }
}

/**
 * Echo the token back into the served HTML, for a caller that already proved
 * it holds one.
 *
 * This is a CONVENIENCE, never a bootstrap: the SPA arrives at `/?token=…`
 * (the URL `rove web` prints), and the meta tag is how the token crosses from
 * the address bar into a place `fetch` can read on every later navigation.
 *
 * It must stay bound to an authenticated requester. `/` is deliberately
 * outside {@link requiresWebToken} — a browser cannot attach a bearer header
 * or the query token to the subresources it fetches on its own, so gating the
 * shell 401s every script and stylesheet. Injecting unconditionally into that
 * open page turned it into a credential dispenser: `curl` with no Origin and
 * no token read the value out of the body and drove the whole `/api/*`
 * surface, including `task.setCommand` (arbitrary command execution). The
 * 0600 mode on the token file exists to stop exactly that caller.
 */
function injectWebToken(html: string, token: string): string {
  const tag = `<meta name="rove-web-token" content="${token}">`
  return html.includes("</head>") ? html.replace("</head>", `  ${tag}\n  </head>`) : `${tag}${html}`
}

/** `token` is supplied ONLY when the request presented it — see
 *  {@link injectWebToken}. An anonymous caller gets the shell verbatim. */
async function staticResponse(pathname: string, staticDir: string, token?: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname
  const resolved = normalize(join(staticDir, rel))
  if (!resolved.startsWith(staticDir)) return new Response("forbidden", { status: 403 })
  const indexPath = join(staticDir, "index.html")
  const isIndex = !existsSync(resolved) || resolved === indexPath
  const file = Bun.file(isIndex ? indexPath : resolved)
  if (!(await file.exists())) {
    return new Response("Rove web assets not built — run `bun --filter kobe-web build`", { status: 503 })
  }
  if (!isIndex || !token) return new Response(file)
  return new Response(injectWebToken(await file.text(), token), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  })
}

/**
 * The 401 body. Shaped like the CLI's typed errors (`toApiError` in
 * `api-cmd.ts`): a `hint` saying what actually went wrong plus the argv that
 * fixes it, because the caller who trips this is either a script that never
 * knew about the token or a browser tab left open across the upgrade that
 * introduced it — and "unauthorized" alone tells neither of them what to do.
 */
function unauthorizedResponse(): Response {
  return Response.json(
    {
      error: "unauthorized: this request carried no valid web token",
      name: "WEB_TOKEN_REQUIRED",
      hint: "the daemon's web transport requires the bearer token in <ROVE_HOME>/.rove/web-token — send it as `Authorization: Bearer $(cat ~/.rove/web-token)` (EventSource clients use ?token=…). A browser tab open from before this daemon started should be reloaded to pick up a fresh token.",
      nextCommandArgs: ["daemon", "restart"],
    },
    { status: 401 },
  )
}

export function createDaemonWebRequestHandler(deps: RequestHandlerDeps): (req: Request) => Promise<Response> {
  const { link, runtime, sseSends, staticDir } = deps
  const tearDown = deps.tearDownSession ?? ((taskId: string) => void tearDownTaskSession(runtime, taskId))
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === DAEMON_WEB_HEALTH_PATH) return new Response(DAEMON_WEB_HEALTH_MARKER)
    if (!originAllowed(req.headers.get("origin"), { allowedHost: deps.allowedHost })) {
      return new Response("forbidden: cross-origin request rejected", { status: 403 })
    }
    // Origin and token are ADDITIVE, not alternatives: Origin says which page
    // is asking (CSRF), the token says whether the caller is entitled at all.
    // A `curl` sends no Origin and so sails past the check above; it is this
    // gate that stops it. Everything that reads or mutates daemon state goes
    // through here, so a route added later is authenticated by default.
    // Computed for EVERY path, not just the gated ones, because the static
    // shell needs the same answer to decide whether it may echo the token
    // back (see injectWebToken).
    const authenticated = deps.webToken !== undefined && tokensMatch(presentedToken(req, url), deps.webToken)
    if (requiresWebToken(url, DAEMON_WEB_HEALTH_PATH) && deps.webToken && !authenticated) {
      return unauthorizedResponse()
    }
    if (url.pathname === "/events") {
      return sseResponse((send) => {
        // Nothing fallible above the acquire. `onSseOpen` bumps the gui
        // refcount and hands back the ONLY way to undo it, so a throw between
        // the two (assembling the snapshot reaches the orchestrator and the
        // activity map) left a phantom gui that nothing could remove: the
        // daemon never idle-exited and every collector polled forever for a
        // browser that got a 500. Build the payload first, acquire last.
        const hydration = link.snapshot()
        const closeGui = deps.onSseOpen?.() ?? (() => {})
        send("snapshot", hydration)
        sseSends.add(send)
        return () => {
          sseSends.delete(send)
          closeGui()
        }
      }, req.signal)
    }
    if (url.pathname === "/api/rpc" && req.method === "POST") return rpcResponse(req, link, tearDown)
    if (url.pathname === "/api/session" && req.method === "POST") return sessionResponse(runtime, req, link)
    if (url.pathname === "/api/engine-spec" && req.method === "GET") {
      return specResponse(url, link, (l, id) => engineSpec(runtime, l, id))
    }
    if (url.pathname === "/api/terminal-spec" && req.method === "GET") {
      return specResponse(url, link, (l, id) => terminalSpec(runtime, l, id))
    }
    if (url.pathname === "/api/engines" && req.method === "GET") return enginesResponse(runtime)
    if (url.pathname === "/api/cli-invocation" && req.method === "GET") return cliInvocationResponse(runtime)
    if (url.pathname === "/api/projects" && req.method === "GET") return projectsResponse(runtime)
    if (url.pathname === "/api/settings" && req.method === "GET") return settingsSnapshot(runtime)
    if (url.pathname === "/api/settings" && req.method === "PATCH") return settingsPatch(runtime, req)
    if (url.pathname === "/api/quick-prompts" && req.method === "GET") return quickPromptsGet(runtime)
    if (url.pathname === "/api/quick-prompts" && req.method === "PUT") return quickPromptsPut(runtime, req)
    const notes = await runtime.handleNotesRequest(req, url)
    if (notes) return notes
    const diff = await runtime.handleDiffRequest(req, url)
    if (diff) return diff
    const history = await runtime.handleHistoryRequest(req, url)
    if (history) return history
    const issues = await handleIssuesRequest(req, url, link)
    if (issues) return issues
    const issueAssets = await handleIssueAssetsRequest(runtime, req, url)
    if (issueAssets) return issueAssets
    const worktrees = await handleWorktreesRequest(runtime, req, url)
    if (worktrees) return worktrees
    const themes = runtime.handleThemesRequest(req, url)
    if (themes) return themes
    if (staticDir) return staticResponse(url.pathname, staticDir, authenticated ? deps.webToken : undefined)
    return new Response("not found", { status: 404 })
  }
}

function latest<C extends ChannelName>(bus: DaemonEventBus, channel: C): ChannelPayloads[C] | null {
  const found = bus.snapshot().find((event) => event.channel === channel)
  return found ? (found.payload as ChannelPayloads[C]) : null
}

function normalizeRepoPath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path
}

function repoSnapshotAliases(tasks: readonly SerializedTask[], repoRoot: string): string[] {
  const root = normalizeRepoPath(repoRoot)
  const aliases = new Set<string>([repoRoot])
  for (const task of tasks) {
    const taskRepo = normalizeRepoPath(task.repo)
    const taskWorktree = normalizeRepoPath(task.worktreePath)
    if (taskRepo === root || taskWorktree === root) {
      if (task.repo) aliases.add(task.repo)
      if (task.worktreePath) aliases.add(task.worktreePath)
    }
  }
  return [...aliases]
}

export function createDirectWebLink(args: {
  orch: DaemonOrchestrator
  bus: DaemonEventBus
  activity: DaemonActivityRegistry
  ctx: (clientId: number) => DaemonHandlerContext
}): DaemonWebLink {
  const handlers = createDaemonHandlerRegistry()
  return {
    async request<T>(name: DaemonRequestName, payload?: unknown): Promise<T> {
      return (await dispatchDaemonRequest(handlers, name, payload, args.ctx(0))) as T
    },
    snapshot(): DaemonWebSnapshotState {
      const tasks = args.orch.listTasks().map(serializeTask)
      const issueSnapshots: Record<string, ChannelPayloads["issue.snapshot"]> = {}
      const issue = latest(args.bus, "issue.snapshot")
      if (issue) {
        for (const alias of repoSnapshotAliases(tasks, issue.repoRoot))
          issueSnapshots[alias] = { ...issue, repoRoot: alias }
      }
      const job = latest(args.bus, "task.jobs")
      const jobs: Record<string, ChannelPayloads["task.jobs"]> = job?.phase === "running" ? { [job.taskId]: job } : {}
      return {
        tasks,
        activeTaskId: latest(args.bus, "active-task")?.taskId ?? null,
        engineStates: args.activity.snapshotByTask(),
        update: latest(args.bus, "update")?.info ?? null,
        jobs,
        worktreeChanges: latest(args.bus, "worktree.changes")?.changes ?? {},
        issueSnapshots,
        deliver: latest(args.bus, "session.deliver"),
        uiPrefs: latest(args.bus, "ui-prefs"),
        connected: true,
      }
    },
  }
}

/**
 * Whether the web transport should bind {@link port}.
 *
 * The web transport is a SECONDARY surface (TUI-first): it must never have a
 * veto over daemon startup and must NEVER kill whatever holds the port.
 *   - port free               → bind.
 *   - held by another kobe web → SKIP (don't fight another daemon for it;
 *     the port-holder IS a live daemon process, so SIGTERM-ing it would kill
 *     every parallel session). The already-listening daemon serves the
 *     browser fine.
 *   - held by a non-kobe svc   → SKIP (a stray `vite preview` on the port must
 *     not make kobe unbootable).
 * A skip degrades the daemon to socket-only; it never throws.
 */
export async function probeWebPort(port: number, healthPath: string = DAEMON_WEB_HEALTH_PATH): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}${healthPath}`, { signal: AbortSignal.timeout(800) })
  } catch {
    // Nothing answered the health probe → assume the port is free to bind.
    // If something races onto it, Bun.serve's EADDRINUSE is caught upstream.
    return true
  }
  return false
}

export async function startDaemonWebServer(opts: DaemonWebServerOptions): Promise<DaemonWebServer> {
  if (opts.takeover !== false && !(await probeWebPort(opts.port))) {
    throw new Error(
      `web port ${opts.port} is already in use — leaving it alone and running socket-only (set ROVE_DAEMON_WEB_PORT to a free port, or 0/off to disable the web transport)`,
    )
  }
  const sseSends = new Set<SseSend>()
  const hostname = opts.hostname?.trim() || process.env.KOBE_WEB_HOST?.trim() || "127.0.0.1"
  const allowedHost = allowedHostForBindHost(hostname)
  // Minted here rather than defaulted inside the handler: `webToken` is
  // optional on the deps so route-level tests need not care, and a default
  // buried in the handler would let a future production call site quietly
  // fall through to no auth. Binding it at THE one place that opens a real
  // socket keeps "listening" and "authenticated" inseparable.
  const webToken = opts.webToken ?? ensureWebToken(opts.webTokenPath ?? defaultWebTokenPath())
  const handle = createDaemonWebRequestHandler({
    runtime: opts.runtime,
    link: opts.link,
    sseSends,
    staticDir: opts.staticDir ? normalize(opts.staticDir) : undefined,
    allowedHost,
    onSseOpen: opts.onSseOpen,
    webToken,
  })
  const server = Bun.serve({ port: opts.port, hostname, idleTimeout: 0, fetch: handle })
  // Subscribed only once there is something to unsubscribe FROM: above the
  // bind, an `ensureWebToken` write error or a lost port race throws past every
  // caller of the returned `close()`, and the bus keeps calling this orphaned
  // closure for the daemon's whole lifetime — once per restart that loses.
  const unsubscribe = opts.onEvent((event) => {
    for (const send of sseSends) send("channel", event)
  })
  return {
    port: server.port ?? opts.port,
    hostname,
    close() {
      unsubscribe()
      server.stop(true)
    },
  }
}
