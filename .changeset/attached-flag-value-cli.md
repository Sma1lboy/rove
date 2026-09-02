---
"@sma1lboy/rove": patch
---

`rove web --port=5399` now binds port 5399, and `rove plugin install owner/repo --ref=v1.2` now checks out `v1.2`. Both value flags only recognised the separated form (`--port 5399`), so the attached `--flag=value` spelling fell through to the default with no error: `rove web --port=foo` proceeded on the default port where `--port foo` already exited with "--port needs a number". The two forms now behave identically, and the port check rejects partial numbers like `51abc` instead of binding 51.
