---
"@sma1lboy/rove": patch
---

Internal: the engine adapters stop re-deriving two things they had each written out by hand.

CLI-binary discovery was four copies of the same probe — a `BinaryDiscoveryDeps` interface, a `defaultDeps` implementation, a not-found error class and a `tryPath` walk, in `claude-code-local`, `codex-local`, `kimi-local` and `copilot-local`. `engine/binary-discovery.ts` now owns *how* to probe (the `which` call and its macOS alias unwrapping, the stat check, the ordered ledger of checked paths that ends up in the error message) and each vendor file owns only *where* to look. Every search order, every checked-path list and its order, every error message and every `error.name` is byte-identical — 420 lines of duplication out, 112 back.

One deliberate behaviour change falls out of it: `kimi` now unwraps a macOS `which` alias line the way the other three already did. An aliased `kimi` used to resolve to the literal `"kimi: aliased to /path"` string, fail the file check, and fall through to the install dirs for no reason.

Vendor config-home resolution — `$CLAUDE_CONFIG_DIR`/`$CODEX_HOME`/`$COPILOT_HOME`/`$KIMI_CODE_HOME` and their default dotdirs — was written nine times across six files, and the copies had already drifted: three treated a blank override as a real path, so `CODEX_HOME="  "` resolved to `/auth.json` at the filesystem root. `engine/vendor-home.ts` is now the single derivation, blank means unset everywhere, and claude's genuine asymmetry (`~/.claude.json` sits at the home root when unset, inside the dir when set) is preserved and documented.
