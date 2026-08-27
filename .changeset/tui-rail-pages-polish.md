---
"@sma1lboy/rove": patch
---

Second TUI polish round, on the three rail pages. Kanban: card ids keep a cell of air from wrapped titles, the lane scrollbar gets its own gutter instead of painting over card borders, an empty lane says "No cards", and below the narrow breakpoint the board renders one full-width lane under a strip of every lane's count instead of four one-word-wide strips. Inbox: section headers no longer charge a card slot in the window (a trailing RECENT header used to dangle with its rows silently clipped), clipped cards surface as "+N more", clipped labels end in `…`, and a too-tight identity line drops the badge label before the label clips mid-word.
