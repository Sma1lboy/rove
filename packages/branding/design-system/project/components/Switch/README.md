# Switch

An on/off toggle: a 30×18px `inset` track with a 12px `muted` knob. When on, the track turns `accent` and the knob turns `paper`.

Static rendition hand-written from `packages/rove-web/src/ui/switch.tsx`.

- Renders a `role="switch"` button, so `on` is announced as `aria-checked`. The consumer supplies `on`, `onClick` and an `aria-label`. There is no visible label inside.
- Use it in Settings rows for a preference that applies at once. A value with more than two states is a cycling row with a chevron, not a switch.
- Track and knob move over 120ms, with no motion under reduced motion. `flex: none` keeps its size beside a long label.
