/**
 * The BUILT-IN engine table — the four first-party adapters' wiring, as
 * data — the DATA half of `registry.ts`, which owns the entry type and the
 * lookup. That is what makes adding an engine a data edit rather than a code
 * one. The module doc there explains what an entry means and why neutral
 * layers must go through `engineEntry` instead of reaching in here.
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
import { trustClaudeWorktree } from "./claude-code-local/trust.ts"
import { readClaudeTurns } from "./claude-code-local/turns.ts"
import { codexCapabilities, codexIdentity } from "./codex-local/capabilities.ts"
import { CodexHookAdapter } from "./codex-local/hook-adapter.ts"
import { fetchCodexQuotaUsage } from "./codex-local/quota.ts"
import { codexSessionIdFromTitle } from "./codex-local/terminal-title.ts"
import { trustCodexWorktree } from "./codex-local/trust.ts"
import { readCodexTurns } from "./codex-local/turns.ts"
import { COPILOT_SCREEN_MANIFEST } from "./copilot-local/screen.ts"
import { trustCopilotWorktree } from "./copilot-local/trust.ts"
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
    // appending a second one makes claude refuse to launch.
    sessionIdentity: {
      pinFlag: "--session-id",
      sessionControlFlags: ["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr"],
      resumeArgv: (base, id) => [...base, "--resume", id],
      // Fork = resume + branch, and claude lets the caller name the branch,
      // so the forked tab is trackable from its first frame like any other
      // claude tab. The three flags combine, and the fork lands in the id
      // we pass.
      forkArgv: (base, sourceId, newId) => {
        const forked = [...base, "--resume", sourceId, "--fork-session"]
        return newId ? [...forked, "--session-id", newId] : forked
      },
    },
    quotaUsage: () => fetchClaudeQuotaUsage(),
    readTurns: readClaudeTurns,
  },
  codex: {
    vendor: "codex",
    builtin: true,
    displayName: codexIdentity.shortName,
    defaultCommand: ["codex"],
    // Effort levels the API accepts, per its own error on an invalid value:
    // "Supported values are: 'none', 'minimal', 'low', 'medium', 'high',
    // 'xhigh', and 'max'." `minimal` is excluded because it is MODEL-scoped,
    // not globally broken — codex rejects it with "'minimal' is not supported
    // with the 'gpt-5.6-luna' model", so offering it would hand the picker a
    // level that fails on the default model. codex 0.149.1 also carries an
    // `ultra` variant in its own enum, but the API has never been observed
    // accepting it; don't offer a level nothing has answered 200 to.
    effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    effortArgv: (base, level) => [...base, "-c", `model_reasoning_effort=${level}`],
    history: codexHistoryReader,

    detectAccount: (deps) => detectCodexAccount(deps),
    createHookAdapter: () => new CodexHookAdapter(),
    createTurnDetector: () => new CodexTurnDetector(),
    capabilities: codexCapabilities,
    identity: codexIdentity,
    trustWorktree: trustCodexWorktree,
    readTurns: readCodexTurns,
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
    // (`codex resume [OPTIONS] [SESSION_ID]`), so the
    // launch flags stay between the verb and the id.
    sessionIdentity: {
      resumeArgv: (base, id) => {
        const [bin, ...rest] = base
        return bin ? [bin, "resume", ...rest, id] : base
      },
      // `codex fork [OPTIONS] [SESSION_ID]` — same
      // subcommand shape as resume, so the launch flags stay between the
      // verb and the positional id. Codex mints the forked thread's own id,
      // so a caller-set one has nowhere to go.
      forkArgv: (base, sourceId) => {
        const [bin, ...rest] = base
        return bin ? [bin, "fork", ...rest, sourceId] : null
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
    trustWorktree: trustCopilotWorktree,
    screenManifest: COPILOT_SCREEN_MANIFEST,
  },
  kimi: {
    vendor: "kimi",
    builtin: true,
    displayName: "Kimi",
    defaultCommand: ["kimi"],
    // kimi's positional CLI slot is a subcommand (export/provider/acp/…),
    // not an initial prompt — argv delivery kills it.
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
    // resumes an existing one ("Resume a session. With ID: resume that
    // session. Without ID: interactively pick."). So its id
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
