---
"@sma1lboy/rove": patch
---

First run now opens Rove instead of a wizard that replaced it.

The setup wizard used to run *instead* of the TUI: `rove` rendered an inline
footer, asked its questions, printed a summary and exited — so a first launch
ended at your own shell prompt and you had to type `rove` a second time to
reach the product. It is now a dialog over the live workspace, so every launch
starts Rove and dismissing the greeting leaves you in it.

The wizard's environment page is gone rather than moved: the welcome pane
behind the dialog already renders the same engine/git verdict from the same
probe. Completions and the agent-skill installer still run with a real
terminal, after the TUI exits.
