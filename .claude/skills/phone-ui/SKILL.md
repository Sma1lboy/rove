---
name: phone-ui
description: How to design, build and check a phone UI here, and how the owner wants that work done. Part 1 is general (any phone screen, web or native): actions where the thumb reaches, bottom sheets, gestures, sizes, where glass goes. Part 2 is how to verify on an iPhone (simulator on the SSD, screenshot board before merge). Part 3 is Rove's phone surfaces (rove-web's narrow layout and the iPhone app, a WKWebView shell). Use for any change to rove-web under 560px or on touch, the iOS app (packages/rove-ios), mobile screenshots or feedback, or "手机/iPhone/iOS/移动端" UI work. Read with rove-ui, which still applies.
---

# Phone UI

The owner's rule, said once and meant everywhere: **what you act on sits where the thumb is, not at the top.**

Condensed 2026-11-27 from five public skills, read in full: wondelai `ios-hig-design` (Apple HIG), wshobson
`mobile-ios-design`, affaan-m `liquid-glass-design` (iOS 26), ceorkm `mobile-app-ui-design`, alinaqi `ui-mobile`,
plus a day of the owner's corrections. Their SwiftUI / React Native code is not reused; only the rules.

## Part 1. Design rules (any phone UI)

### 1.1 Reach decides placement
- **Top is for reading**: where you are (back, title) and status. Nothing used often lives there.
- **Bottom third is for doing**: the screen's actions, inputs and view switches.
- **One primary action per screen, bottom-right**, accent-tinted, the biggest control. Everything else is secondary
  or behind `⋯`.
- Back stays top-left, but the left-edge swipe is the real way back; never break it.
- Check: in a 390×844 shot, every control used more than once per visit is in the lower ~40%.

### 1.2 Bars, sheets, menus
- **Bottom bar**: ≤5 items, the rest behind `⋯`; hidden while the keyboard is up; pads for
  `env(safe-area-inset-bottom)`; content scrolls under it and pads so its last row is reachable.
- **Pickers, menus, confirmations rise from the bottom as sheets**, not centred cards or dropdowns anchored to a
  chip: drag handle, swipe down or tap outside closes, half height first. Options are ≥44px rows, current checked.
- **Undo over confirm** when reversible (toast with Undo); confirm only what loses work. Destructive red, at the
  bottom of a sheet; Cancel last.

### 1.3 Gestures before buttons
- Edge swipe right = back, swipe down = dismiss a sheet, pull down = refresh. Never repurpose them.
- Row: swipe left = archive/delete, swipe right = pin; long-press = the row's full menu.
- Every gesture also has a visible way; gestures remove clutter, not abilities.

### 1.4 Size and spacing
- Hit targets ≥44×44 with ≥8px between neighbours; screen margins 16–20px.
- Type: secondary ~13, body ~15 (iOS body is 17; go there if it still reads small), titles ~16; nothing under 12;
  line height ≥1.3; at most four sizes per screen; hierarchy by weight and tone.
- A text field is ≥16px, or iOS Safari zooms the page on focus.
- Fewer, bigger controls beat a full row of small ones: a key row shows ~6 and folds the rest behind `⋯`.

### 1.5 Glass (iOS 26 look)
- Only on **controls that float over content**: bottom bars, rounded-square icon buttons (back, settings, new; same
  shape family as Send), the composer, key rows, the session's single view button. Never on content, rows or cards.
- Controls that belong together share one capsule, not a row of separate bubbles.
- Primary action = accent-tinted glass; the rest neutral. Solid fill under reduced transparency / no backdrop-filter.
- Glass needs something behind it: let content scroll under a floating bar instead of giving the bar its own band.
- In a web view, native Liquid Glass can't render: emulate it (translucent token fill, `backdrop-filter`, top
  hairline highlight, soft shadow, press scale).

### 1.6 Keep the product's identity
The phone changes placement, size and touch, not the brand: no SF Pro, system blue, gradients or celebration
animation unless the product already has them.

## Part 2. How the work is done (the owner's process)

- **Pin down what he points at before building.** A screenshot with "this part" can mean more than one area;
  "the part under the input" once meant the phone's voice control, not the desktop chip row, and cost a revert.
  If two readings fit, crop both and ask in one line.
- **Show screenshots before merging.** Put before/after on one page (`brand-studio-share <dir>/index.html`, images
  inlined), dark and light, 390 wide (375 and 430 for layout changes). Merge after he looks, not before.
- **Open every screenshot you report.** Numbers alone are not "checked"; say which ones you only measured.
- **Verify on the iOS Simulator, on the SSD only.** Device set `xcrun simctl --set /Users/jacksonc/i/.simulators …`
  on every call; xcodebuild `-derivedDataPath /Users/jacksonc/i/.xcode-derived/<project>`; archives in
  `/Users/jacksonc/i/.xcode-archives`. Never the default device set on the internal disk.
  If creation sticks with `CoreSimulatorService deny file-read-data /Users/jacksonc/i/...` in the log, macOS privacy
  blocks the external disk: ask him to grant Full Disk Access; meanwhile Chromium's iPhone emulation, labelled as such
  (its 2× canvas enlarges terminal text — compare 1× shots).
- **Touch-only controls** (hold-to-talk, swipes, the soft keyboard) can't be checked in desktop emulation: say so and
  put the build on his live preview for his phone.
- **Desktop must not move.** Phone-only changes are diffed against main at 1440 (pixel-identical or explained).
- **Subagents** run on Fable, get these SSD paths in the brief, commit on a branch and stop; iOS work is reviewed
  with him before merge or TestFlight.

## Part 3. Rove's phone surfaces

- **rove-web's phone layout** is the `narrow` variant (`.app.is-narrow`, under 560px) plus `touch:`; phone type is a
  token override in `src/tailwind.css`. Glass is one recipe, `src/ui/glass.ts`; round nav buttons are
  `src/ui/nav-button.tsx`. Arbitrary values stay inside `src/ui/` (rove-ui §0).
- **A mouse reaches the phone layout too** (a narrow window, DevTools emulation): a row takes `hover:bg-hover`, a
  glass control `GLASS_HOVER` (glass.ts). Tailwind's `hover:` only applies to a pointer that hovers, so a tap leaves
  nothing behind; never write `[&:hover]:`. A `button` does not select or open iOS's callout (tailwind.css, base layer).
- **A phone screen composes `src/ui/phone.tsx`** (`PhoneBar` back + title + trailing controls, `PhoneTitle`,
  `PHONE_LIST`, `PhoneGroup` + `PHONE_ROW` grouped cards) and `src/ui/sheet.tsx`. The bottom bar is one app-level
  `PhoneBarHost` that stays put while pages push and pop, and changes only once the page has landed: old contents
  fade, the glass melts to its new outline (two pieces into one through a goo filter), new contents fade in, never
  two labels at once. A screen declares it with `usePhoneBar` (`PhonePage`'s `primary`/`action` does this). A sheet keeps its own foot (`PhoneActions`).
  The page branches once (`useNarrow()`) into a phone tree and a desktop tree; don't thread `w-narrow:` variants
  through a desktop recipe for a new phone screen.
- **The iPhone app** (`packages/rove-ios`) is a native shell around rove-web: native only for pairing (scan or paste
  the bridge's link, Keychain, several computers), mic and camera permission, the unreachable page, external links to
  Safari. Everything users see of tasks is the web, so its rows, states and actions match the web by construction;
  never add a native view that draws tasks differently.
- **WKWebView limits**: the mic needs a secure context (https; plain LAN http won't record), Web Push does not work
  inside it (notifications need APNs from the bridge), no native glass.
- **TestFlight** needs the Apple team id and an App Store Connect API key (key id, issuer id, `.p8`); bump
  `CURRENT_PROJECT_VERSION` in `project.yml` every upload; update `packages/rove-ios/docs/REVIEW_NOTES.md` when what
  the app does changes. Internal testing skips App Review.
