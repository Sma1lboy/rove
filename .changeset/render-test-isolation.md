---
"@sma1lboy/rove": patch
---

test(render): fix cross-test fragility in render track

Move the `toast-truncation` Harness toast push from render phase into a mount-only `useEffect`. Calling `useNotifications().notify()` during render set state on `NotificationsProvider` while React was still rendering `Harness`, which corrupted renderer state and leaked across test files, flakily failing later tests such as `worktrees-page-delete`.
