# Rove UI on a phone

Read this for any change to rove-web's phone layout (`narrow`, under 560px, touch), which is also what the iPhone
app shows (a WKWebView shell). SKILL.md still applies; this file says what changes when the thing is held in one
hand. The owner's rule, said once and meant everywhere: what you act on sits where the thumb is, not at the top.

Condensed on 2026-11-27 from: wondelai/skills `ios-hig-design` (Apple HIG: layout, navigation, components, gestures,
typography), wshobson/agents `mobile-ios-design` (HIG patterns, sheets, toolbars), affaan-m/ecc
`liquid-glass-design` (iOS 26 glass: when and where), ceorkm `mobile-app-ui-design` (thumb zone, hierarchy),
alinaqi/maggy `ui-mobile` (touch defaults). Their SwiftUI/React Native code does not apply; only the rules below.

## 1. Reach decides placement

- **Top of the screen is for reading**: where you are (back, title) and status. Nothing you do often lives there.
- **Bottom third is for doing**: the screen's actions, inputs and view switches.
- **One primary action per screen, bottom-right**, accent-tinted, the biggest control: New task on the session
  list, Send in a session, Start on New session. Everything else is secondary or goes behind `⋯`.
- Back stays top-left (iOS habit) but the left-edge swipe is the real way back; never break it.
- Check: in a 390×844 screenshot, every control used more than once per visit is in the lower ~40%.

## 2. Bars, sheets, menus

- **Bottom bar**: at most 5 items; more go behind `⋯`. Hidden while the keyboard is up. Pads for
  `env(safe-area-inset-bottom)`; the list under it pads so its last row is reachable.
- **Pickers, menus and confirmations come up from the bottom as sheets**, not centred popovers or dropdowns
  anchored to a chip: a drag handle, swipe down or tap outside to dismiss, half height first, full height when the
  list is long. Choices are rows (≥44px), the current one checked.
- **Undo over confirm** when the action can be reversed (archive: a toast with Undo); **confirm** only what loses
  work (delete with unmerged changes). Destructive rows red, at the bottom of a sheet, Cancel last.

## 3. Gestures before buttons

- Edge swipe right = back; swipe down = dismiss a sheet; pull down = refresh a list. Never repurpose these.
- Session row: swipe left = archive (delete behind it), swipe right = pin; long-press = the row's full menu.
- Every gesture also has a visible way (the long-press menu or a button); gestures remove clutter, not abilities.

## 4. Size and spacing

- Hit targets ≥44×44px with ≥8px between neighbours; screen margins 16–20px.
- Type on the phone: meta 13, body 15, row titles 16 (iOS body is 17; go there if something still reads small).
  Nothing readable under 12. Line height ≥1.3. Hierarchy by weight and tone, at most four sizes on a screen.
- Fewer, bigger controls beat a full row of small ones: a key row shows ~6 keys and folds the rest behind `⋯`.

## 5. Glass (the owner's exception to SKILL.md §9)

- Glass (`src/ui/glass.ts`) is for **controls that float over content**: bottom bars, round icon buttons (back,
  settings, new), the composer, the key row, the session's view switcher. Never on content, rows or cards.
- Controls that belong together sit in one glass capsule, not a row of separate bubbles.
- The primary action is accent-tinted glass; the others neutral. Solid fill under reduced transparency.
- It only reads as glass with something behind it: let lists scroll under a floating bar instead of giving the bar
  its own band.

## 6. Keep Rove's identity

Not adopted from those skills: SF Pro, blue tint, gradients, celebratory animation. Rove keeps its mono structure,
terracotta accent and `[ rove ]` wordmark; the phone changes placement, size and touch, not the brand.

## 7. Check

- 375 (iPhone SE) and 430 (Pro Max) wide, dark and light, in the iOS Simulator's Safari or the shell when it runs
  (device set on the SSD, `xcrun simctl --set /Users/jacksonc/i/.simulators`), else Chromium iPhone emulation, said so.
- Keyboard up: the composer sits on it, nothing it needs is covered.
- Every screen: where is the primary action, can the thumb reach it, what does a swipe do.
