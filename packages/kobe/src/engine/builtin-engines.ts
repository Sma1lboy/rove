/**
 * The BUILT-IN engine table — the four first-party adapters' wiring, as
 * data. Split out of `registry.ts` (the ~500-line cap); the module doc
 * there explains what an entry means and why neutral layers must go
 * through `engineEntry` instead of reaching in here.
 *
 * Adding a built-in engine = one entry here plus its `*-local/` modules.
 * The entry TYPE stays in `registry.ts` (imported type-only, so the pair is
 * not a runtime cycle) — same shape as `history-readers.ts` and
 * `contrib-engines.ts`.
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

import {
  type ClaudeAccount,
  type CodexAccount,
  type CopilotAccount,
  type DetectDeps,
  type EngineAccountStatus,
  type KimiAccount,
  detectClaudeAccount,
  detectCodexAccount,
  detectCopilotAccount,
  detectKimiAccount,
} from "./account-detect.ts"
import { claudeCapabilities, claudeIdentity } from "./claude-code-local/capabilities.ts"
import { ClaudeHookAdapter } from "./claude-code-local/hook-adapter.ts"
import { fetchClaudeQuotaUsage } from "./claude-code-local/quota.ts"
import { CLAUDE_SCREEN_MANIFEST } from "./claude-code-local/screen.ts"
import { trustClaudeWorktree } from "./claude-code-local/trust.ts"
import { readClaudeTurns } from "./claude-code-local/turns.ts"
import { codexCapabilities, codexIdentity } from "./codex-local/capabilities.ts"
import { CodexHookAdapter } from "./codex-local/hook-adapter.ts"
import { fetchCodexQuotaUsage } from "./codex-local/quota.ts"
import { CODEX_SCREEN_MANIFEST } from "./codex-local/screen.ts"
import { codexSessionIdFromTitle } from "./codex-local/terminal-title.ts"
import { trustCodexWorktree } from "./codex-local/trust.ts"
import { COPILOT_SCREEN_MANIFEST } from "./copilot-local/screen.ts"
import {
  EMPTY_HISTORY,
  claudeHistoryReader,
  codexHistoryReader,
  copilotHistoryReader,
  kimiHistoryReader,
} from "./history-readers.ts"
import { type EngineHookAdapter, NoopHookAdapter } from "./hook-adapter.ts"
import { KimiHookAdapter } from "./kimi-local/hook-adapter.ts"
import { KIMI_SCREEN_MANIFEST } from "./kimi-local/screen.ts"
import { trustKimiWorktree } from "./kimi-local/trust.ts"
// Type-only, so the registry↔table pair is not a runtime cycle.
import type { EngineRegistryEntry } from "./registry.ts"
import { ClaudeTurnDetector, CodexTurnDetector, UnknownTurnDetector } from "./turn-detector.ts"

/** The first-party entries — registered here and nowhere else. */
export const BUILTIN_ENGINES: Record<"claude" | "codex" | "copilot" | "kimi", EngineRegistryEntry> = {
  claude: {
    vendor: "claude",
    builtin: true,
    // The adapter's EngineIdentity is the source of truth for name copy
    // (AGENTS.md: engine-owned UI data); displayName is the resolved view
    // every neutral layer reads via engineDisplayName().
    displayName: claudeIdentity.shortName,
    defaultCommand: ["claude"],
    history: claudeHistoryReader,
    detectAccount: (deps) => detectClaudeAccount(deps),
    createHookAdapter: () => new ClaudeHookAdapter(),
    createTurnDetector: () => new ClaudeTurnDetector(),
    capabilities: claudeCapabilities,
    identity: claudeIdentity,
    trustWorktree: trustClaudeWorktree,
    terminalTitle: {
      ownsStatus: true,
      // `${prefix} ${title}` where prefix is ✳ at rest and cycles through
      // animated frames while a turn runs (`AnimatedTerminalTitle`).
      statusPrefixes: ["✳", "⠂", "⠐", "◐", "◑"],
      workingPrefixes: ["⠂", "⠐", "◐", "◑"],
    },
    // Claude is the one engine that lets the CALLER name a new session, so
    // Rove pins a fresh uuid at launch and the tab is trackable from its
    // first frame. `--session-id <uuid>` is documented; the control flags
    // are every documented way a command can already own its session —
    // appending a second one makes claude refuse to launch (issue #58).
    sessionIdentity: {
      pinFlag: "--session-id",
      sessionControlFlags: ["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr"],
      resumeArgv: (base, id) => [...base, "--resume", id],
    },
    quotaUsage: () => fetchClaudeQuotaUsage(),
    readTurns: readClaudeTurns,
    screenManifest: CLAUDE_SCREEN_MANIFEST,
  },
  codex: {
    vendor: "codex",
    builtin: true,
    displayName: codexIdentity.shortName,
    defaultCommand: ["codex"],
    // Effort levels real `codex exec` accepts (the broken `minimal` is
    // deliberately excluded — CHANGELOG 0.5.17).
    effortLevels: ["none", "low", "medium", "high", "xhigh"],
    history: codexHistoryReader,

    detectAccount: (deps) => detectCodexAccount(deps),
    createHookAdapter: () => new CodexHookAdapter(),
    createTurnDetector: () => new CodexTurnDetector(),
    capabilities: codexCapabilities,
    identity: codexIdentity,
    trustWorktree: trustCodexWorktree,
    screenManifest: CODEX_SCREEN_MANIFEST,
    // Codex's default is activity + project-name, which makes every tab in
    // one repo say "rove". Keep its native activity state, but ask Codex to
    // pair it with the thread title it already owns in its local store.
    terminalTitle: {
      ownsStatus: true,
      launchArgs: ["-c", 'tui.terminal_title=["activity","thread-title"]'],
      // The `activity` segment is a braille spinner frame joined to the next
      // segment by a space (codex `TERMINAL_TITLE_SPINNER_FRAMES` +
      // `separator_from_previous`). It only appears while a turn runs, so a
      // resting title has no prefix to strip — every status prefix is a
      // working prefix.
      statusPrefixes: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      workingPrefixes: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      // `thread-title` falls back to the thread ID until codex names the
      // thread, so that title is usually a bare UUID. The id names the
      // rollout the tab's first prompt lives in, which is what Rove shows
      // instead — see `codex-local/terminal-title.ts`.
      sessionIdFromTitle: codexSessionIdFromTitle,
    },
    // No pin flag — codex mints its own thread id and reports it in the OSC
    // title (see `terminalTitle.sessionIdFromTitle`), which is origin (2) in
    // `session-identity.ts`. Resume is a SUBCOMMAND with the id positional
    // (`codex resume [OPTIONS] [SESSION_ID]`, probed 2026-08-29), so the
    // launch flags stay between the verb and the id.
    sessionIdentity: {
      resumeArgv: (base, id) => {
        const [bin, ...rest] = base
        return bin ? [bin, "resume", ...rest, id] : base
      },
    },
    quotaUsage: () => fetchCodexQuotaUsage(),
  },
  copilot: {
    vendor: "copilot",
    builtin: true,
    displayName: "Copilot",
    defaultCommand: ["copilot"],
    history: copilotHistoryReader,
    detectAccount: (deps) => detectCopilotAccount(deps),
    createHookAdapter: () => new NoopHookAdapter("copilot"),
    // Copilot persists no turn-completion marker kobe can read yet.
    createTurnDetector: () => new UnknownTurnDetector("copilot"),
    screenManifest: COPILOT_SCREEN_MANIFEST,
  },
  kimi: {
    vendor: "kimi",
    builtin: true,
    displayName: "Kimi",
    defaultCommand: ["kimi"],
    // kimi's positional CLI slot is a subcommand (export/provider/acp/…),
    // not an initial prompt — argv delivery kills it (issue #25).
    firstMessageDelivery: "paste",
    // The installed Mach-O binary rewrites its process title to `kimi-co`
    // after launch, so a live kimi session's argv[0] never reads `kimi`.
    processNames: ["kimi-co"],
    trustWorktree: trustKimiWorktree,
    history: kimiHistoryReader,
    detectAccount: (deps) => detectKimiAccount(deps),
    createHookAdapter: () => new KimiHookAdapter(),
    createTurnDetector: () => new UnknownTurnDetector("kimi"),
    // Kimi cannot be TOLD what to call a new session — `-S [id]` only
    // resumes an existing one (probed 2026-08-29: "Resume a session. With
    // ID: resume that session. Without ID: interactively pick."). So its id
    // is origin (3): discovered after the fact from the session store this
    // entry's `history` reader already indexes by worktree. `-c/--continue`
    // and `-S` both mean the user's command owns the session already.
    sessionIdentity: {
      sessionControlFlags: ["-S", "--session", "-c", "--continue"],
      resumeArgv: (base, id) => [...base, "-S", id],
    },
    screenManifest: KIMI_SCREEN_MANIFEST,
  },
}
