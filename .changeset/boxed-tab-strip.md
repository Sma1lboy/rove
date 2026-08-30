---
"@sma1lboy/rove": patch
---

Boxed tab strip, on by default

Every workspace tab now renders as a bordered rounded box; the active tab
omits its bottom edge so its frame reads as a notch opening into the pane it
shows (claude-squad's `activeTabBorder`). Tabs sit flush — the frames are the
gutter — and the workspace/files-pane chrome picks up rounded borders with a
more visible inactive border color.

The strip also switches its default from `never` to `always`: the sidebar
tree lists every tab, but the strip is the affordance that says WHICH tab
the pane below is showing. Users who preferred the tree alone can set
`chat.tabStrip.mode` to `never` (Settings → General → Terminal).
