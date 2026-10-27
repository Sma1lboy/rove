/**
 * GitHub credentials per machine. Rove keeps no token: a machine's sign-in is its own `gh` login, and
 * Rove's account is the hub's. State that outlives a call (the device-flow child) lives in the daemon,
 * so a caller that is not the daemon re-sends the verb there.
 */

import type { ApiEnvelope } from "@sma1lboy/rove-daemon/daemon/protocol"
import { applyToken, deviceLogin, localStatus, logoutGithub, readHubToken, syncTo } from "../../github/credentials.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

async function inDaemon(
  ctx: VerbContext,
  verb: string,
  params: Record<string, string | boolean>,
  here: () => Promise<unknown>,
) {
  if (ctx.caller.daemon) return here()
  const envelope = await daemonOf(ctx).request<ApiEnvelope>("api.invoke", { verb, params })
  if (envelope.ok) return envelope.result
  const { message, code, ...data } = envelope.error
  throw new ApiError(message, code, data)
}

export const GITHUB_VERBS: readonly VerbSpec[] = [
  {
    name: "github-status",
    group: "read",
    summary:
      "Can THIS machine use GitHub? Returns { git, gh (versions or null), account (the signed-in `gh` login or null), host, protocol, scopes, gitUsesGh (git pushes through gh), ssh: { ok, user?, detail? }, login: { state: pending|syncing|failed, code?, url?, error? } | null }. Missing tools are values, never errors. Add --machine <alias> for another machine.",
    flags: [],
    handler: (ctx) => inDaemon(ctx, "github-status", {}, () => localStatus()),
  },
  {
    name: "github-login",
    group: "edit",
    summary:
      "Sign THIS machine's `gh` in to GitHub with the device flow: returns { state, code, url } — type the code at the URL; poll `github-status` (.login) until `.account` is set. One flow per machine: a second call returns the pending one. --cancel stops it. When it finishes, `git` is set up to use it and the other machines that are signed out receive the same account (never one already signed in as someone else).",
    flags: [
      {
        name: "cancel",
        type: "bool",
        description: "Stop the pending flow (or dismiss its failure) instead of starting one.",
      },
    ],
    handler: (ctx) => {
      const cancel = ctx.args.bool("cancel") === true
      return inDaemon(ctx, "github-login", cancel ? { cancel } : {}, async () =>
        cancel ? { cancelled: deviceLogin.cancel() } : deviceLogin.start(ctx.caller.forwarded !== true),
      )
    },
  },
  {
    name: "github-logout",
    group: "edit",
    summary:
      "Sign THIS machine's `gh` out of github.com (`gh auth logout` for the active account). Returns the new github-status. Signs the machine out for every tool that uses gh, not only Rove.",
    flags: [],
    handler: (ctx) => inDaemon(ctx, "github-logout", {}, () => logoutGithub()),
  },
  {
    name: "github-sync",
    group: "edit",
    summary:
      "Give a registered machine THIS machine's GitHub account: reads this machine's `gh` token in the daemon and signs the target's `gh` in with it (the token is never printed or stored). Returns the target's github-status. Takes --to, not --machine, because the verb itself runs here. Refused when another machine's hub sends it.",
    flags: [
      {
        name: "to",
        type: "string",
        required: true,
        placeholder: "ALIAS",
        description: "The registered machine to sign in.",
      },
    ],
    handler: (ctx) => {
      if (ctx.caller.forwarded) {
        throw new ApiError("github-sync only runs on the machine whose account is shared", "GITHUB_SYNC_FORWARDED")
      }
      const to = ctx.args.require("to")
      return inDaemon(ctx, "github-sync", { to }, async () => syncTo(to, await readHubToken()))
    },
  },
  {
    name: "github-apply",
    group: "edit",
    summary:
      "INTERNAL — sent by another machine's `github-sync`, not for direct use. Signs this machine's `gh` in with --token (piped to gh over stdin) and returns the new github-status. Refused unless another machine's hub forwarded it.",
    flags: [
      {
        name: "token",
        type: "string",
        required: true,
        placeholder: "TOKEN",
        description: "A GitHub token for `gh auth login --with-token`.",
      },
    ],
    handler: async (ctx) => {
      if (!ctx.caller.forwarded) {
        throw new ApiError(
          "github-apply only accepts a call forwarded from another machine",
          "GITHUB_APPLY_FORWARDED_ONLY",
          {
            hint: "use `rove api github-sync --to <alias>` on the machine whose account you want to share",
          },
        )
      }
      return applyToken(ctx.args.require("token"))
    },
  },
]
