import { spawnSync } from "node:child_process"
import { arch, platform, release } from "node:os"
import { getGlobalDefaultVendor } from "../state/vendor-prefs.ts"
import { DEFAULT_TASK_VENDOR } from "../types/task.ts"
import { CURRENT_VERSION, owningNpmPrefix, repoSlug } from "../version.ts"

/** What the reporter is filing; each maps to one repo label. */
export const FEEDBACK_KINDS = ["bug", "idea", "question"] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]
export const DEFAULT_FEEDBACK_KIND: FeedbackKind = "bug"

const KIND_LABEL: Record<FeedbackKind, string> = { bug: "bug", idea: "enhancement", question: "question" }

/** GitHub rejects very long prefilled-issue URLs; the body is cut to stay well under that. */
const MAX_PREFILL_BODY = 4000

type SpawnSync = typeof spawnSync

type FeedbackDeps = {
  spawn: SpawnSync
  repoSlug: () => string | null
  /** The environment block appended to the body. */
  env: () => string
}

export type SubmitFeedbackInput = {
  title: string
  body: string
  kind?: FeedbackKind
}

export type SubmitFeedbackResult =
  | { filed: true; url: string; number: number }
  /** `url` is a prefilled new-issue page to open in a browser; `hint` says why `gh` could not file it. */
  | { filed: false; url: string; hint: string }

export function isFeedbackKind(value: string): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly string[]).includes(value)
}

function installKind(): string {
  if (import.meta.url.includes("/$bunfs/") || import.meta.url.includes("B:\\~BUN")) return "compiled binary"
  return owningNpmPrefix() ? "npm global" : "source or bun"
}

function defaultEngineId(): string {
  try {
    return getGlobalDefaultVendor() ?? DEFAULT_TASK_VENDOR
  } catch {
    return DEFAULT_TASK_VENDOR
  }
}

/** The footer every report carries, so the team can reproduce without a follow-up question. */
export function environmentBlock(): string {
  return [
    "---",
    "Reported from Rove:",
    `- rove: ${CURRENT_VERSION}`,
    `- os: ${platform()} ${release()} (${arch()})`,
    `- install: ${installKind()}`,
    `- default engine: ${defaultEngineId()}`,
  ].join("\n")
}

function normalizeText(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  return trimmed
}

/** The exact `gh` argv; the body goes over stdin (`--body-file -`) so size and quoting never matter. */
export function issueCreateArgv(slug: string, title: string, kind: FeedbackKind): string[] {
  return ["issue", "create", "-R", slug, "--title", title, "--label", KIND_LABEL[kind], "--body-file", "-"]
}

export function newIssueUrl(slug: string, title: string, body: string, kind: FeedbackKind): string {
  const prefilled = body.length > MAX_PREFILL_BODY ? `${body.slice(0, MAX_PREFILL_BODY)}\n\n[truncated]` : body
  const query = new URLSearchParams({ title, body: prefilled, labels: KIND_LABEL[kind] })
  return `https://github.com/${slug}/issues/new?${query.toString()}`
}

const ISSUE_URL = /https:\/\/\S+\/issues\/(\d+)/

/**
 * File a GitHub issue through the user's `gh`. Any `gh` failure (not installed, not signed in, no
 * access, offline) returns the prefilled new-issue link instead of throwing: the report is never lost.
 */
export function submitFeedback(input: SubmitFeedbackInput, deps: Partial<FeedbackDeps> = {}): SubmitFeedbackResult {
  const title = normalizeText(input.title, "feedback title")
  const kind = input.kind ?? DEFAULT_FEEDBACK_KIND
  const body = `${normalizeText(input.body, "feedback body")}\n\n${(deps.env ?? environmentBlock)()}`
  const slug = (deps.repoSlug ?? repoSlug)()
  if (!slug) throw new Error("package repository is not a GitHub repository")

  const fallback = (why: string): SubmitFeedbackResult => ({
    filed: false,
    url: newIssueUrl(slug, title, body, kind),
    hint: `${why} Run \`gh auth login\` to file from here, or open the link to file it in your browser.`,
  })

  const result = (deps.spawn ?? spawnSync)("gh", issueCreateArgv(slug, title, kind), { encoding: "utf8", input: body })
  if (result.error) return fallback(`Could not run gh (${result.error.message}).`)
  const stdout = String(result.stdout ?? "")
  if ((result.status ?? 0) !== 0) {
    const detail = String(result.stderr ?? "").trim()
    return fallback(`gh could not create the issue${detail ? ` (${detail})` : ""}.`)
  }
  const match = stdout.match(ISSUE_URL)
  if (!match?.[1]) return fallback("gh did not print the new issue's URL.")
  return { filed: true, url: match[0], number: Number(match[1]) }
}
