---
"@sma1lboy/rove": patch
---

Retire the `productName`, `assistantName`, and `inputPlaceholder` fields on engine identity. Nothing ever read them: only `shortName` reaches the UI, so the built-in engines, plugin engines, and the plugin manifest parser now carry `shortName` alone. Plugin manifests that still set `product_name`, `assistant_name`, or `input_placeholder` keep loading unchanged, since unknown identity keys are ignored.
