---
"@sma1lboy/rove": patch
---

On an Apple silicon Mac and on 64-bit Intel Linux, Rove now draws through its own build of OpenTUI's native library. The picture is the same; a frame whose colours change writes up to a third fewer bytes to your terminal, which you notice over SSH and not on a local machine. Other platforms keep the stock library, and `ROVE_STOCK_OPENTUI=1 rove` forces it everywhere.
