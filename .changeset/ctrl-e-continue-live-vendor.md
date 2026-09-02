---
"@sma1lboy/rove": patch
---

Continue a conversation from a wrapper engine. ctrl+e → continue on a tab
running a custom preset that wraps a built-in CLI (a `claudecpa` shell
function around `claude`) refused with "No conversation in this tab to fork
yet": the preset id resolved to the empty engine entry, so kobe read no
transcripts and found no fork verb. It now resolves the source engine from
the live process the tab is actually running, and the forked tab still
launches the preset the user picked.
