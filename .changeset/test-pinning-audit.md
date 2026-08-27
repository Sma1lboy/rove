---
"@sma1lboy/rove": patch
---

Un-pin four test assertions that guarded the wrong thing.

A targeted audit after PR #585/#594 found more assertions protecting what
they should prevent. The release-guidance ordering check used bare `indexOf`
with no presence guard, so deleting the canonical `npm view` line turned it
green (-1 < anything); it now asserts presence before order. The daemon
`@types/node` check pinned the literal `25.6.2`, turning every routine bump
red — it now asserts lockstep with the kobe package's own pin. Two kobe-web
tests (`ptyEnv`, api-client headers) used whole-object equality where the
intent was removals-plus-additions and one required header, so any harmless
new env var or request header broke them. Every relaxation was re-proven:
deleting the guarded behavior still fails each test. The full audit report
(including implementation bugs pinned by tests, left for follow-up) lives in
`.scratch/test-pinning-audit.md`.
