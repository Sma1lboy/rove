---
"@sma1lboy/rove": patch
---

Settings → Engines and Plugins now scroll with the keyboard cursor

The two sections built from bare boxes never registered a cursor row, so only General, Keybindings and Dev followed the cursor. On a narrow terminal the Engines header wraps to about fourteen lines and pushes every engine row below the fold: `j`/`k` moved a cursor nobody could see, which made switching an engine on, renaming it, resetting it, setting the default, or adding a new one unreachable by keyboard on the one page that registers custom engines. Both sections now register through `useCursorFollow`, the mechanism the sidebar and Kanban pages already use, and the settings-only second mechanism it duplicated is gone.
