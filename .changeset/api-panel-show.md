---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

An agent can now drive the web side panel and tell what screen you are on. `rove api viewers` lists every UI that is showing a task — TUI, web page or phone — with whether it has a side panel, whether the panel is open, whether the page is narrow, and whether it runs on the same machine as the daemon (a page behind a tunnel does not, so its `localhost` is not the agent's). `rove api panel-show --view browser|files|diff [--url URL] [--path FILE]` makes every web page remember that view for the task and opens it on the one you are looking at, without moving focus or switching task. For a URL it also reports whether the page is reachable and whether the site allows being framed, from one `HEAD` request to a public HTTPS address (private and loopback addresses are refused, redirects are not followed). The bridge pushes the request to browsers as a `panel` event and answers `browser.probe` for the same check.
