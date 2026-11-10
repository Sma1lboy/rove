# Tabs

A segmented row of mono tabs (All / Changes). The selected tab sits on `inset`, and turns `accent` while its pane holds keyboard focus.

Static rendition hand-written from `packages/rove-web/src/ui/tabs.tsx`.

- The consumer supplies `tabs` (`{ id, label }[]`), `value` and `onChange`. The pane that owns the keys carries `group/pane`, which is how the accent knows the pane is focused.
- Type: mono, `fs-meta`, 600 weight. Padding 3×10px, gap 4px, `radius-sm`. Unselected tabs are `muted`.
- Labels are one or two words. Never change the weight on selection.
