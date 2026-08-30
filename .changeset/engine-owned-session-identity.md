---
"@sma1lboy/rove": patch
---

Every engine now answers "what is my session id" and "how do I resume it" for itself, so a restart reconnects a kimi or wrapper-engine tab to its conversation instead of opening a blank one.

Session identity was hard-coded to Claude in two places: the launch pinned an id only when the vendor was literally named `claude`, and the restart path always appended Claude's `--resume` flag. Kimi tabs therefore never recorded an id at all — and neither did custom wrapper engines like a `claudecpa` preset, which is a Claude launch under another name. Each engine now declares its own session verbs (`engine/session-identity.ts`): Claude pins `--session-id` and resumes with `--resume`, Codex resumes through its `resume` subcommand, and Kimi — whose CLI can only reopen an existing session, never name a new one — has its id discovered from its session store after the fact and resumes with `-S`. A custom preset inherits the verbs of the protocol it declares. An engine with no resume verb starts a fresh conversation honestly rather than being passed a flag that would kill its launch.

Also fixes the restart existence check, which asked whether Rove could parse a session's messages rather than whether the session existed — so engines that ship no message parser reported every conversation as absent.
