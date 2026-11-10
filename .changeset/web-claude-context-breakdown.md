---
"@sma1lboy/rove": patch
---

The web Context column now shows what a Claude conversation's context window is made of: system prompt, system tools, MCP tools, custom agents, memory files, skills and messages, each with its tokens and share of the window, and the files, tools and skills behind a part when you open it. Rove asks Claude Code itself for this when you open the column, so the percentage and window size match `/context`; before, a Claude conversation showed one token total and no percentage.
