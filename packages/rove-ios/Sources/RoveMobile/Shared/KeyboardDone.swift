import SwiftUI
import UIKit

enum Keyboard {
    /// Drops the keyboard whoever holds it, a SwiftUI field or the SwiftTerm view. A nil-targeted
    /// `resignFirstResponder` action leaves SwiftTerm focused; ending editing on the window does not.
    @MainActor static func dismiss() {
        for scene in UIApplication.shared.connectedScenes {
            for window in (scene as? UIWindowScene)?.windows ?? [] where window.isKeyWindow { window.endEditing(true) }
        }
    }

    /// The scroll view holding the input the bar last revealed; `settle` puts it back when the keyboard goes.
    @MainActor private static weak var revealedIn: UIScrollView?

    /// Scrolls the focused text input up until it ends `margin` above `limit` (window coordinates). SwiftUI
    /// brings a focused field above the keyboard, but not above a bar laid out on top of the keyboard.
    @MainActor static func reveal(above limit: CGFloat, margin: CGFloat = 8) {
        guard let input = FirstResponder.find() as? UIView, input is UITextInput, let window = input.window else { return }
        var view = input.superview
        while let v = view, !(v is UIScrollView) { view = v.superview }
        guard let scroll = view as? UIScrollView else { return }
        revealedIn = scroll
        let overlap = input.convert(input.bounds, to: window).maxY + margin - limit
        guard overlap > 0 else { return }
        let maxOffset = scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height
        let y = min(scroll.contentOffset.y + overlap, max(maxOffset, scroll.contentOffset.y))
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: true)
    }

    /// After the keyboard goes: content that fits its scroll view sits at the top again, rather than keep
    /// the few points it was scrolled to clear the keyboard.
    @MainActor static func settle() {
        guard let scroll = revealedIn else { return }
        revealedIn = nil
        let inset = scroll.adjustedContentInset
        guard scroll.contentSize.height + inset.top + inset.bottom <= scroll.bounds.height,
              scroll.contentOffset.y != -inset.top else { return }
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: -inset.top), animated: true)
    }
}

extension EnvironmentValues {
    /// Height of the `done` bar while it shows; `keyboardBarMargin()` reads it.
    @Entry var keyboardBarHeight: CGFloat = 0
}

/// A form's scroll view does not count the `done` bar (a safe-area inset of an ancestor) in its own insets;
/// this margin lets its last field scroll clear of the bar.
private struct KeyboardBarMargin: ViewModifier {
    @Environment(\.keyboardBarHeight) private var height
    func body(content: Content) -> some View { content.contentMargins(.bottom, height, for: .scrollContent) }
}

/// The current first responder, found by sending it an action.
private final class FirstResponder: NSObject {
    @MainActor private static weak var found: UIResponder?
    @MainActor static func find() -> UIResponder? {
        found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.roveCaptureFirstResponder), to: nil, from: nil, for: nil)
        return found
    }
    @MainActor fileprivate static func capture(_ r: UIResponder) { found = r }
}

extension UIResponder {
    @objc fileprivate func roveCaptureFirstResponder() { MainActor.assumeIsolated { FirstResponder.capture(self) } }
}

/// `done`: drops the keyboard.
struct KeyboardDoneButton: View {
    var body: some View {
        Button { Keyboard.dismiss() } label: {
            Text(String(localized: "Done").lowercased())
                .font(Theme.mono(14, .semibold))
                .foregroundStyle(Theme.accent)
                .padding(.horizontal, 10)
                .frame(minWidth: 44, minHeight: 36)
        }
        .buttonStyle(.pressable)
        .accessibilityLabel("Hide keyboard")
        .accessibilityIdentifier("keyboardDone")
    }
}

/// Follows the software keyboard (and the hardware-keyboard assistant bar) on and off screen.
private struct KeyboardTracker: ViewModifier {
    @Binding var up: Bool

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in up = true }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in up = false }
    }
}

/// A `done` bar on the keyboard, laid out as a bottom safe-area inset so content ends on top of it.
/// Not the system keyboard toolbar: on iOS 26 that floats a glass capsule over whatever sits just above
/// the keyboard (a send button, a sheet's primary bar).
private struct KeyboardDoneBar: ViewModifier {
    var active: Bool
    @State private var up = false
    /// `.null` until measured: its minY is +∞, so nothing is revealed against a bar not yet laid out.
    @State private var bar = CGRect.null

    func body(content: Content) -> some View {
        content
            .environment(\.keyboardBarHeight, up && active ? bar.height : 0)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if up && active {
                    HStack {
                        Spacer()
                        KeyboardDoneButton()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 2)
                    .background(Theme.paper)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("keyboardBar")
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { bar = $0 }
                }
            }
            .modifier(KeyboardTracker(up: $up))
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                if up && active { Keyboard.reveal(above: bar.minY) }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
                if active { Keyboard.settle() }
            }
    }
}

extension View {
    /// The `done` bar for a screen or sheet with text input. `active` is false while a sheet covers the view,
    /// so only the topmost presentation shows one.
    func keyboardDoneButton(active: Bool = true) -> some View { modifier(KeyboardDoneBar(active: active)) }

    /// On a form's scroll view inside a `keyboardDoneButton()` screen or sheet.
    func keyboardBarMargin() -> some View { modifier(KeyboardBarMargin()) }

    /// Keeps `up` equal to "the keyboard is on screen".
    func trackKeyboard(_ up: Binding<Bool>) -> some View { modifier(KeyboardTracker(up: up)) }
}
