---
"@sma1lboy/rove": patch
---

Stop peer agents from talking past each other. Every `[ROVE PEER]` message ended with "load the Rove agent skill FIRST … then reply", which receivers read as an instruction to answer each message and re-read the skill each time — so tasks acknowledged receipt, announced they had started, announced they had loaded the skill, and acknowledged each other's acknowledgements, each at one full engine turn. The prefix now points at the skill as once-per-session reading and names the reply address without demanding a reply, and the agent skill gains a "Communicate at handoffs, not at every step" rule: one complete brief, one final outcome, and an interim message only when it changes what the recipient does next. The reply command is unchanged and still tab-precise.
