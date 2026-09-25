/**
 * The built-in engine table — the DATA half of `registry.ts`, which owns the
 * entry type and lookup (and explains why neutral layers go through
 * `engineEntry`). Adding a built-in = one entry here plus its `*-local/`
 * modules. `EngineRegistryEntry` is imported type-only, so the pair is not a
 * runtime cycle.
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

import type { BuiltinVendorId } from "@/types/vendor"
import {
  detectBobAccount,
  detectClaudeAccount,
  detectCodexAccount,
  detectCopilotAccount,
  detectKimiAccount,
} from "./account-detect.ts"
import { bobHistoryReader } from "./bob-local/history.ts"
import { BOB_SCREEN_MANIFEST } from "./bob-local/screen.ts"
import { trustBobWorktree } from "./bob-local/trust.ts"
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
import { CopilotHookAdapter } from "./copilot-local/hook-adapter.ts"
import { COPILOT_SCREEN_MANIFEST } from "./copilot-local/screen.ts"
import { trustCopilotWorktree } from "./copilot-local/trust.ts"
import {
  claudeHistoryReader,
  codexHistoryReader,
  copilotHistoryReader,
  kimiHistoryReader,
  ompHistoryReader,
  piHistoryReader,
} from "./history-readers.ts"
import { NoopHookAdapter } from "./hook-adapter.ts"
import { KimiHookAdapter } from "./kimi-local/hook-adapter.ts"
import { KIMI_SCREEN_MANIFEST } from "./kimi-local/screen.ts"
import { trustKimiWorktree } from "./kimi-local/trust.ts"
import { CLAUDE_MODELS, CODEX_MODELS, listOmpModels, listPiModels } from "./model-lists.ts"
import { ompCapabilities, ompIdentity, piCapabilities, piIdentity } from "./pi-local/capabilities.ts"
import { PiFamilyHookAdapter } from "./pi-local/hook-adapter.ts"
import { OMP_SCREEN_MANIFEST, PI_SCREEN_MANIFEST } from "./pi-local/screen.ts"
import {
  OMP_ATTENTION_PREFIXES,
  OMP_STATUS_PREFIXES,
  OMP_WORKING_PREFIXES,
  PI_STATUS_PREFIXES,
} from "./pi-local/terminal-title.ts"
import { trustPiWorktree } from "./pi-local/trust.ts"
import type { EngineRegistryEntry } from "./registry.ts"
import { ClaudeTurnDetector, CodexTurnDetector, UnknownTurnDetector } from "./turn-detector.ts"

/** Keyed by the vendor union: a new id in `BUILTIN_VENDORS` fails to compile
 *  until its entry lands here. */
export const BUILTIN_ENGINES: Record<BuiltinVendorId, EngineRegistryEntry> = {
  claude: {
    vendor: "claude",
    builtin: true,
    // EngineIdentity owns name copy; neutral layers read engineDisplayName().
    displayName: claudeIdentity.shortName,
    defaultCommand: ["claude"],
    // `--model <alias|full name>`; no list verb, so the suggestions are the
    // documented aliases (`model-lists.ts`).
    listModels: async () => CLAUDE_MODELS,
    modelArgv: (base, model) => [...base, "--model", model],
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
    // Rove pins a fresh uuid via `--session-id` so the tab is trackable from
    // its first frame. Control flags = every way a command already owns its
    // session; appending a second makes claude refuse to launch.
    sessionIdentity: {
      pinFlag: "--session-id",
      sessionControlFlags: ["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr"],
      resumeArgv: (base, id) => [...base, "--resume", id],
      // The three flags combine; the fork lands in the id we pass.
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
    // Per the API's own error: 'none', 'minimal', 'low', 'medium', 'high',
    // 'xhigh', 'max'. `minimal` is excluded — rejected on the default model
    // ("not supported with the 'gpt-5.6-luna' model"). codex 0.149.1's enum
    // also has `ultra`, never observed accepted by the API.
    effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    effortArgv: (base, level) => [...base, "-c", `model_reasoning_effort=${level}`],
    // `-m, --model <MODEL>`; no list verb (`model-lists.ts` for the slugs).
    listModels: async () => CODEX_MODELS,
    modelArgv: (base, model) => [...base, "--model", model],
    history: codexHistoryReader,

    detectAccount: (deps) => detectCodexAccount(deps),
    createHookAdapter: () => new CodexHookAdapter(),
    createTurnDetector: () => new CodexTurnDetector(),
    capabilities: codexCapabilities,
    identity: codexIdentity,
    trustWorktree: trustCodexWorktree,
    readTurns: readCodexTurns,
    // Codex's default title is activity + project-name, so every tab in a repo
    // says "rove"; pair activity with the thread title instead.
    terminalTitle: {
      ownsStatus: true,
      launchArgs: ["-c", 'tui.terminal_title=["activity","thread-title"]'],
      // `activity` is a braille spinner frame + space, present only mid-turn,
      // so every status prefix is a working prefix.
      statusPrefixes: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      workingPrefixes: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      // `thread-title` is a bare thread UUID until codex names the thread; see
      // `codex-local/terminal-title.ts`.
      sessionIdFromTitle: codexSessionIdFromTitle,
    },
    // No pin flag: codex mints its id and reports it in the OSC title (origin
    // (2) in `session-identity.ts`). Resume/fork are SUBCOMMANDS with a
    // positional id (`codex resume [OPTIONS] [SESSION_ID]`), so launch flags go
    // between verb and id.
    sessionIdentity: {
      resumeArgv: (base, id) => {
        const [bin, ...rest] = base
        return bin ? [bin, "resume", ...rest, id] : base
      },
      // Codex mints the forked thread's id; a caller-set one has nowhere to go.
      forkArgv: (base, sourceId) => {
        const [bin, ...rest] = base
        return bin ? [bin, "fork", ...rest, sourceId] : null
      },
    },
    quotaUsage: () => fetchCodexQuotaUsage(),
  },
  /**
   * IBM Bob Shell. `bob` alone prints help — the TUI is `bob chat`. It is
   * built-in for its history and account reads, not for hooks: Bob's bundle
   * carries Claude's nested hook schema but nothing fired from either the
   * workspace (`<workspace>/.bob/settings.json`) or the global
   * (`~/.bob/settings/settings.json`) document on 2.0.5, and no feature flag
   * names one. Session identity therefore comes from the history store keyed
   * by worktree, the same origin kimi uses.
   *
   * `--trust` stays in the command even though `trustWorktree` writes the
   * same record: the hook is best-effort and must never block a launch, and a
   * folder gate nobody can answer is what breaks a parallel round.
   *
   * "paste", not "argv": `bob chat` declares no positional, and Bob 2.0.5
   * SILENTLY DROPS one rather than failing — an argv first message would
   * leave every sibling of a fan-out sitting at an empty composer.
   */
  bob: {
    vendor: "bob",
    builtin: true,
    displayName: "IBM Bob",
    defaultCommand: ["bob", "chat", "--trust"],
    firstMessageDelivery: "paste",
    history: bobHistoryReader,
    detectAccount: (deps) => detectBobAccount(deps),
    trustWorktree: trustBobWorktree,
    // Bob persists no per-turn completion marker kobe can read.
    createHookAdapter: () => new NoopHookAdapter("bob"),
    createTurnDetector: () => new UnknownTurnDetector("bob"),
    screenManifest: BOB_SCREEN_MANIFEST,
  },
  copilot: {
    vendor: "copilot",
    builtin: true,
    displayName: "Copilot",
    defaultCommand: ["copilot"],
    history: copilotHistoryReader,
    detectAccount: (deps) => detectCopilotAccount(deps),
    createHookAdapter: () => new CopilotHookAdapter(),
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
    // `-m, --model <alias>` — an alias from the user's own config.toml, which
    // Rove cannot list; no `listModels`, so the picker is free text.
    modelArgv: (base, model) => [...base, "--model", model],
    trustWorktree: trustKimiWorktree,
    history: kimiHistoryReader,
    detectAccount: (deps) => detectKimiAccount(deps),
    createHookAdapter: () => new KimiHookAdapter(),
    createTurnDetector: () => new UnknownTurnDetector("kimi"),
    // Kimi can't be told a new session's id (`-S [id]` only resumes), so its
    // id is origin (3): discovered from the session store `history` indexes by
    // worktree.
    sessionIdentity: {
      sessionControlFlags: ["-S", "--session", "-c", "--continue"],
      resumeArgv: (base, id) => [...base, "-S", id],
    },
    screenManifest: KIMI_SCREEN_MANIFEST,
  },
  pi: {
    vendor: "pi",
    builtin: true,
    displayName: piIdentity.shortName,
    defaultCommand: ["pi"],
    // From `--thinking`'s help line.
    effortLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    effortArgv: (base, level) => [...base, "--thinking", level],
    // `--model <pattern>` (fuzzy, or exact `provider/id`); `pi --list-models`
    // is the catalog (`model-lists.ts`).
    listModels: listPiModels,
    modelArgv: (base, model) => [...base, "--model", model],
    history: piHistoryReader,
    // No account detector: pi also authenticates via env var / `--api-key`,
    // so a missing auth file isn't "logged out". Absent = "not detectable".
    createHookAdapter: () => new PiFamilyHookAdapter("pi"),
    // No readable turn marker; hooks are the authority, screen the fallback.
    createTurnDetector: () => new UnknownTurnDetector("pi"),
    capabilities: piCapabilities,
    identity: piIdentity,
    trustWorktree: trustPiWorktree,
    terminalTitle: {
      // pi writes `π - <session name> - <cwd>` with no run state, so Rove's
      // own turn glyph shows status; only the brand prefix is stripped.
      ownsStatus: false,
      statusPrefixes: PI_STATUS_PREFIXES,
    },
    // `--session-id <id>` pins a new session's id (creating it if missing);
    // `--session <id>` opens one.
    sessionIdentity: {
      pinFlag: "--session-id",
      sessionControlFlags: ["--session-id", "--session", "-c", "--continue", "-r", "--resume", "--fork"],
      resumeArgv: (base, id) => [...base, "--session", id],
      forkArgv: (base, sourceId) => [...base, "--fork", sourceId],
    },
    screenManifest: PI_SCREEN_MANIFEST,
  },
  omp: {
    vendor: "omp",
    builtin: true,
    displayName: ompIdentity.shortName,
    defaultCommand: ["omp"],
    // Same flag and level set as pi (omp is the fork that kept both).
    effortLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    effortArgv: (base, level) => [...base, "--thinking", level],
    // `--model=<value>`; catalog is `omp models --json` (omp rejects pi's
    // `--list-models`).
    listModels: listOmpModels,
    modelArgv: (base, model) => [...base, `--model=${model}`],
    history: ompHistoryReader,
    createHookAdapter: () => new PiFamilyHookAdapter("omp"),
    createTurnDetector: () => new UnknownTurnDetector("omp"),
    capabilities: ompCapabilities,
    identity: ompIdentity,
    terminalTitle: {
      // `π <separator> <label>`; the separator IS the run state (spinner,
      // `>` at rest, `!` blocked on a human), so Rove draws no second one.
      ownsStatus: true,
      statusPrefixes: OMP_STATUS_PREFIXES,
      workingPrefixes: OMP_WORKING_PREFIXES,
      attentionPrefixes: OMP_ATTENTION_PREFIXES,
    },
    // No pin flag (`-r/--resume [id prefix]` only reaches existing sessions);
    // the id is discovered from the hook payload's `session_id` or the
    // `history` store.
    sessionIdentity: {
      sessionControlFlags: ["-c", "--continue", "-r", "--resume"],
      resumeArgv: (base, id) => [...base, "-r", id],
    },
    screenManifest: OMP_SCREEN_MANIFEST,
  },
}
