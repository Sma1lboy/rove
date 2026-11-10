---
"@sma1lboy/rove": patch
---

You can now change keybindings from Settings → Keybindings instead of editing YAML. Every binding is a row: press `enter` on it, then the key you want (press the prefix key first to put it behind the prefix). `backspace` restores the default and `x` unbinds. Changes are saved to `~/.rove/settings/keybindings.yaml` and apply at once; a key that can't work is refused with the reason.
