import { readFileSync } from "node:fs"
import { FEEDBACK_KINDS, type FeedbackKind, isFeedbackKind, submitFeedback } from "../lib/feedback.ts"
import { ROVE_PRODUCT_NAME } from "../product.ts"

const CLI_NAME = ROVE_PRODUCT_NAME

const FEEDBACK_USAGE = [
  `Usage: ${CLI_NAME} feedback --title <text> (--body <text> | --body-file <path>) [--kind bug|idea|question]`,
  "",
  "File a GitHub issue on the Rove repository using the GitHub CLI. Rove appends its",
  "version, OS, install kind and default engine to the body.",
  "",
  "Requires:",
  "  gh auth login",
  "Without a signed-in gh, prints a prefilled new-issue link to open instead.",
  "",
  "Options:",
  "  --title <text>       Issue title",
  "  --body <text>        Issue body",
  "  --body-file <path>   Read the issue body from a file; use - for stdin",
  "  --kind <kind>        bug (default, label bug), idea (enhancement) or question",
  "  -h, --help           Print this help",
  "",
].join("\n")

type ParsedFeedbackArgs = {
  help: boolean
  title?: string
  body?: string
  bodyFile?: string
  kind?: string
}

function usageError(message: string): never {
  process.stderr.write(`${CLI_NAME} feedback: ${message}\n\n${FEEDBACK_USAGE}\n`)
  process.exit(2)
}

function readBodyFile(path: string): string {
  if (path === "-") return readFileSync(0, "utf8")
  return readFileSync(path, "utf8")
}

export function parseFeedbackArgs(args: readonly string[]): ParsedFeedbackArgs {
  const parsed: ParsedFeedbackArgs = { help: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h" || arg === "help") return { ...parsed, help: true }
    if (arg === "--title") {
      parsed.title = args[++i]
      if (parsed.title === undefined) usageError("--title requires a value")
      continue
    }
    if (arg === "--body") {
      parsed.body = args[++i]
      if (parsed.body === undefined) usageError("--body requires a value")
      continue
    }
    if (arg === "--body-file") {
      parsed.bodyFile = args[++i]
      if (parsed.bodyFile === undefined) usageError("--body-file requires a value")
      continue
    }
    if (arg === "--kind") {
      parsed.kind = args[++i]
      if (parsed.kind === undefined) usageError("--kind requires a value")
      if (!isFeedbackKind(parsed.kind)) usageError(`--kind must be one of ${FEEDBACK_KINDS.join(", ")}`)
      continue
    }
    usageError(`unexpected argument "${arg}"`)
  }
  return parsed
}

export async function runFeedbackSubcommand(args: readonly string[]): Promise<void> {
  const parsed = parseFeedbackArgs(args)
  if (parsed.help) {
    process.stdout.write(`${FEEDBACK_USAGE}\n`)
    return
  }
  if (!parsed.title) usageError("--title is required")
  if (parsed.body && parsed.bodyFile) usageError("pass either --body or --body-file, not both")

  const body = parsed.bodyFile ? readBodyFile(parsed.bodyFile) : parsed.body
  if (!body) usageError("--body or --body-file is required")

  const result = await submitFeedback({ title: parsed.title, body, kind: parsed.kind as FeedbackKind | undefined })
  if (result.filed) {
    console.log(`filed issue #${result.number}: ${result.url}`)
    return
  }
  console.log(`not filed: ${result.hint}\n${result.url}`)
}
