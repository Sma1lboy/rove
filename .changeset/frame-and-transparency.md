---
"@sma1lboy/rove": patch
---

One source for the TUI's rounded borders, transparency that reaches the last solid tiles, and tab titles that stop overflowing their strip.

**Rounded corners come from one place now.** opentui hard-codes square corners as its Box default and offers no global override, so every framed surface had to opt in by hand — and half of them never did. The workspace pane, files pane and tab strip were rounded while the prefix HUD, context menu, story dialog, automations strips and split frames were square. All ten spread a shared `FRAME` instead, so the next framed box is rounded because its author spread the shared thing, not because they remembered a prop whose absence only shows up in a screenshot.

**Transparent mode reaches the cards and the story dialog.** A kanban card and the dialog's input wells kept a solid fill with transparency on — the one thing on screen you could not see through. Opaque mode is unchanged.

**A kanban card costs one row less.** `padding={1}` was doing three jobs at once (air inside the card, separation from the next card, a break between title and description) and charging two rows for it. Split into horizontal padding, a lane margin, and the existing box gap: same three effects, one row cheaper per card.

**A tab title wider than the pane is now ellipsised.** It used to push the tab's own right frame off the clipped strip and run to the last column with nothing saying it had been cut — a long shell name did this routinely. Truncation happens before the width the scroll math reads, so the viewport still scrolls by a width that is actually drawn.
