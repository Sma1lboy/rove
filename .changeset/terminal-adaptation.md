---
"@sma1lboy/rove": patch
---

Fix four places the TUI assumed a wide, tall, kitty-speaking terminal

The Changes tab budgeted its path column in display cells but spent that
budget by counting code points, so a Chinese path — the ordinary case, Rove
defaults to Simplified Chinese — could be "short enough" and still overrun.
`文档/设计/终端渲染说明书笔记.md` is 18 code points and 31 cells against a
26-cell budget, so the row drew five cells through the pane border onto the
workspace beside it and dragged the `+N`/`−N` columns out of alignment. Paths
now truncate against the same cell measurer the sidebar, tab strip and toasts
already use, and the row's other segments spend the budget in cells too.

Settings padded every General label to a flat 30 cells whatever the terminal
width. At 46 columns — the phone-SSH width the docs promise — the row only
owns 26, so the padding alone overran it and the label was cut with no
ellipsis to say so; at 50 it consumed the budget exactly, leaving the inline
hint structurally unreachable. The column is now a maximum, not a floor: it
shrinks with the row, and when there is no room for both, the hint is dropped
whole rather than clipped to a fragment.

The new-task dialog sized its picker window to a fixed 8 rows regardless of
terminal height, while the dialog card is capped at the viewport and nothing
scrolls it. On a 24-row terminal the bottom six rows were clipped away —
including the Create button and the submit error, so a failed create looked
like nothing happening at all. The window now follows the viewport, down to a
floor of two rows; the list still scrolls, so no entry became unreachable.
The branch picker and the clone/adopt tabs shared the same fixed window.

`rove doctor` regained the terminal diagnosis it lost as collateral damage
when the tmux runtime was removed: multiplexer nesting (tmux, zellij, screen)
and a live kitty-keyboard-protocol probe. Both split chords require that
protocol, so without the probe doctor could not answer a "split doesn't work"
report at all.
