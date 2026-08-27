---
"@sma1lboy/rove": patch
---

Wire `EngineIdentity` into the live display-name path: the built-in registry entries now derive `displayName` from each adapter's `identity.shortName`, so the identity contract AGENTS.md points at is what every neutral layer actually reads through `engineDisplayName()`. A new architecture test (`test/architecture/engine-owned-copy.test.ts`) locks the boundary in: any capitalized vendor name landing in TUI/web/orchestrator/client/daemon source outside the two documented bridge fallbacks fails CI.
