---
"@sma1lboy/rove": patch
---

Fix the Chime volume setting skipping a level when the stored volume sat between two steps. The Settings → General → Chime volume row cycles through 10% / 25% / 40% / 60% / 80% / 100%, but its "next step" search anchored on the first step at or above the current value and then advanced once more, so a value that was not itself a step — a hand-edited `notifications.sound.volume`, say — jumped two steps at once: cycling from 0.5 landed on 80% and 60% could never be selected. It now anchors on the nearest step at or below the current value, so every press moves up exactly one step, and a sub-minimum or silent `0` cycles up to the quietest 10% step.
