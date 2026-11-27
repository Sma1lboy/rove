# App Review notes

Text to paste into App Store Connect. Read it again before each submission; nothing here is sent
automatically.

## What to Test

Rove is a coding-agent tool that runs on a person's own computer. This app is its phone screen: it opens
the Rove page that the computer serves, so you can see your coding sessions, read what the agents wrote
and the code they changed, and answer them from your phone.

You do not need a computer to review it. The app has a demo built in:

1. Launch the app. The first screen asks for a computer's pairing link.
2. Tap **try a demo**, under the **connect** button.
3. A strip at the top now reads `demo · not connected to a computer`. Everything under it runs on sample
   data inside the app.

What to try in the demo:

- The list shows six sample sessions in two projects. Tap **Verify refund webhook signatures**.
- The session opens on its terminal: a recorded agent conversation, ending on a question the agent asks.
- The button at the top right switches views. **Diff** shows the files the agent changed, line by line.
- Back on the list, the inbox button at the bottom left lists what needs a reply; the gear opens settings.
- **new task** at the bottom right opens the form for starting a session.

Actions such as sending a message or starting a session answer "done" and change nothing. **connect a
computer** in the strip leaves the demo. Nothing about the demo is saved: after a relaunch the app is back
on the first screen.

## Review notes

**What the app is.** A client for the Rove page served by `rove --web`, which a person starts on their
own computer. The phone pairs by scanning the QR code the computer shows or by pasting its link. Without
such a computer there is nothing to pair with, so the demo above is the way to review the app.

**What is native (guideline 4.2).** The session screens are the computer's Rove page. Around it, the app
does what a web page cannot:

- Scanning the pairing QR code with the camera.
- Keeping the links of several computers in the iOS Keychain, switching between them, and forgetting one.
  Holding two fingers on the page opens the list.
- Asking for the microphone, so hold-to-talk works inside the page.
- Haptic feedback on its own buttons and on the page's main actions, swipes and hold-to-talk.
- A native screen when the computer can't be reached, with **retry** and the list of computers.
- Opening links to other sites in Safari, instead of inside the app.
- The demo, served from inside the app.

**Microphone.** Recording runs only while the talk button is held. The audio goes to the user's own
computer, which turns it into text. Nothing is recorded in the demo, and the app never records in the
background.

**Camera.** Only to scan the pairing QR code. Nothing is recorded or kept. Pasting the link works without it.

**Accounts.** None. There is no sign-up and no login. The pairing link carries a token for the user's own
computer.

**Network.** The app talks only to the user's own computer, over the local network, Tailscale or a tunnel
the user set up. It contacts no server run by Rove. The demo makes no network requests at all.

**Data.** No analytics, no ads, no tracking. The only third-party code is SwiftTerm, an open-source
terminal view.

**Encryption.** No cryptography of its own. Connections use the system networking stack.
`ITSAppUsesNonExemptEncryption` is `false`.

**Privacy policy.** https://rove.run/privacy (also linked from the first screen).

## Age rating

The 2026 questionnaire, answer by answer. The app is a developer tool: it shows the user's own coding
sessions and has no content of its own, so every answer is None or No, which gives **4+**.

| Question | Answer |
| --- | --- |
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Prolonged graphic or sadistic realistic violence | None |
| Profanity or crude humor | None |
| Mature or suggestive themes | None |
| Horror or fear themes | None |
| Medical or treatment information | None |
| Alcohol, tobacco or drug use or references | None |
| Simulated gambling | None |
| Sexual content or nudity | None |
| Graphic sexual content and nudity | None |
| Guns or other weapons | None |
| Contests | None |
| Unrestricted web access | No: links to other sites open in Safari, outside the app |
| User-generated content | No: the app shows only the user's own sessions; nothing is shared with other users |
| Messaging and chat | No: messages go to the user's own coding agents, not to other people |
| Advertising | No |
| Gambling | No |
| Loot boxes | No |
| Shared location | No |
| Dating and relationships | No |
| Health or wellness topics | No |
| Parental controls | No |
| Age assurance | No |
| Made for Kids | No |
| Age rating override | None: keep the computed rating, 4+ |
