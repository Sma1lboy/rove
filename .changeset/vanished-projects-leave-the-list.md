---
"@sma1lboy/rove": patch
---

A project whose checkout directory is gone no longer stays in the sidebar. The daemon drops the row and the saved entry on its next sweep, touching nothing on disk; a directory that disappeared together with its parent is read as an unmounted volume and its project stays for the remount.
