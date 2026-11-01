---
"@sma1lboy/rove": patch
---

`rove api send --queue` waits for a running turn instead of landing in it: an idle tab takes the prompt now, a busy one has it held by the daemon and pasted when the turn ends, one per turn, never into a permission menu (`queue-list`, `queue-cancel`). Without it, a prompt sent mid-turn made Codex drop the work in flight. The web's message field on a phone now queues while the agent works and shows each held message as a chip you can take back.
