---
"@sma1lboy/rove": patch
---

Add a chime volume setting, and make volume work at all on Windows. The notification chime was mastered at full scale and Rove passed the volume to the audio player as a flag — but four of the players it can land on take no volume argument, including the PowerShell fallback that Windows always uses, whose `Media.SoundPlayer` has no volume API. So on Windows the chime rang at 100% and nothing could turn it down but muting it. Volume is now applied to the audio itself, cached one copy per level, which every player honours. Cycle it from Settings → General → Chime volume (10% through 100%, default 40%), or set `notifications.sound.volume`; `0` plays nothing and spawns no process.
