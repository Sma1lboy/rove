---
"@sma1lboy/rove": patch
---

[tui][web][cli] Hosted sessions now start Claude, Codex, Antigravity and Cursor with their skip-permission-prompts flag, so an unattended session no longer stalls on the first approval. Rove adds nothing when your launch command already picks a permission mode, and Claude's one-time consent screen is skipped too. Turn it off in Settings → Engines → Permissions. Plugin engines can declare their own flag with `permission_bypass_flag`.
