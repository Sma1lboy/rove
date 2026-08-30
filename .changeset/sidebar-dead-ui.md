---
"@sma1lboy/rove": patch
---

Remove sidebar leftovers that promised UI nobody could reach

The sidebar hover-tooltip path was cut end to end: the flat row cards that
fed it are gone from the product, the tree sidebar never had hover handlers,
nothing rendered the tooltip, and the `sidebar.hover.enabled` setting never
existed outside a comment — so the `hoverEnabled` / `onHoverChange` props and
the tooltip-line builder were dead weight. Also removed two orphaned task
callbacks (`onSortModeToggle`, `onPreviewToggleRequest`) whose bindings left
the keymap in earlier changes, and clarified the doc comment on the pin
callback: a bare `p` binds nothing, so a mistyped press matches no chord
rather than churning the pin flag. No visible behavior changes; the `t`
sort chord keeps working exactly as shipped.
