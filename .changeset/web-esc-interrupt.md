---
"@sma1lboy/rove": patch
---

Esc interrupts the engine from the web again. A click on a top-bar icon, a panel's close button or the task you are already on left focus on that button, so Esc, and typing, reached nobody and the engine kept running. An Esc that no pane, field or overlay takes now goes to the terminal on screen. The keyboard routes back to the terminal (`focus.next`, `F4`, `tasks.focusEngine`) matched a `.term-slot` class that the Tailwind refactor stopped rendering, so they did nothing; they find the active terminal again, and clicking the open task's row puts the keyboard back in its terminal.
