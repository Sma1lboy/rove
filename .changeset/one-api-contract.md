---
"@sma1lboy/rove": patch
"@sma1lboy/rove-plugin-sdk": patch
---

`rove api` verbs are now one contract served three ways: the CLI, an `api.invoke` request on the daemon socket, and an `api.invoke` op on the bridge (`rove --web`). The socket and bridge take `{ verb, params }` with params keyed by flag name and answer `{ apiVersion, ok, result | error }`, where `error` is the same object the CLI prints. `rove api --envelope` prints that envelope too, and `rove api schema`, both `hello`s and every envelope report one `apiVersion` (now 3). Bridge refusals keep their `hint` and `nextCommandArgs`, and the plugin SDK's `RoveSocket` gains `invoke(verb, params)`.
