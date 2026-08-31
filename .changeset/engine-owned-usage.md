---
"@sma1lboy/rove": patch
---

Web transcript token chips now come from the engine, not from re-reading Claude's format

The dashboard's Chat pane computed its "ctx / in / out" chips in the browser
by summing the raw `input_tokens` / `cache_read_input_tokens` /
`cache_creation_input_tokens` fields of Claude's JSONL — vendor-shaped math
living in a neutral layer, exactly what the engine-owned-data rule forbids.
An engine whose transcripts carry a different shape (Codex, and any future
engine) silently rendered as "zero tokens", indistinguishable from a session
that genuinely used nothing.

Usage now arrives as the reader's normalized `EngineUsageSnapshot`: each
adapter owns its vendor's context arithmetic (Claude's adapter derives the
last turn's full prompt and marks it approximate; Codex's adapter reports the
last turn's engine-reported input; Copilot keeps its engine-reported context),
and the `/api/history/messages` route forwards the snapshot alongside the
messages. When an engine doesn't surface usage at all (Kimi's unverified
wire, custom engines), the snapshot is absent and the pane renders no chips —
"not reported" instead of "zero", the same honesty `read-output`'s
`engine_unsupported` answer has.

Also tightens the duplicated built-in-engine lists: the daemon's `VendorId`
is a plain pass-through string again (its literal union had already drifted
from the shipped engine list by missing Kimi, and the open string branch
would have hidden the next drift inside an exhaustive-looking switch), and
`isBuiltinVendor` / the plugin engine-id shadow check now derive from the one
`BUILTIN_VENDORS` list instead of hand-maintained copies.
