---
"@sma1lboy/rove": patch
---

Sidebar rows now say where a PR stands with its reviewers. The poller has been
writing `reviewDecision` and folding an approved open PR into a `ready_to_merge`
lifecycle since it landed, and neither reached the screen: a green `✓` looked
identical on a PR that is approved and clear, one still waiting on a reviewer,
and one that merged an hour ago — which is exactly the distinction you need when
picking which parallel attempt to land. `»` marks approved and clear to advance,
`≡` marks already merged (muted; it is history, not news), and both drain to
grey when the last PR poll failed. Both glyphs are one cell in Fira Code,
JetBrainsMono Nerd Font, Menlo and Monaco.
