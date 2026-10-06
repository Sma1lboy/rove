import SwiftUI
import UIKit

// Shared pieces of the Settings screens: the pushed-page chrome, hairline-divided groups,
// mono tags, the destructive confirm sheet, and the stale-daemon notice.

/// Pushed screen: header with back, scrolling body, optional pull-to-refresh. Solid paper, no nav bar.
struct SettingsPage<Content: View>: View {
    var title: String
    var refresh: (() async -> Void)? = nil
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) {
                Text(title).font(Theme.face(16, .semibold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
            } trailing: { EmptyView() }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) { content }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .refreshable { await refresh?() }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}

struct SettingsDivider: View {
    var body: some View { Rectangle().fill(Theme.line).frame(height: 1) }
}

/// Mono tag in a tone: `default`, `off`, `linked`.
struct SettingsTag: View {
    var text: String
    var tint: Color = Theme.muted
    var bold = false

    var body: some View {
        Text(text).font(Theme.mono(11, bold ? .bold : .medium)).foregroundStyle(tint).lineLimit(1).fixedSize()
    }
}

/// Mono key on the left, value on the right: the pairing-screen info row.
struct SettingsInfoRow: View {
    var key: String
    var value: String
    var tint: Color = Theme.ink

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(key).font(Theme.mono(13)).foregroundStyle(Theme.muted)
            Spacer(minLength: 12)
            Text(value).font(Theme.mono(13)).foregroundStyle(tint)
                .multilineTextAlignment(.trailing).textSelection(.enabled)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
    }
}

/// A loadable value: three visible states for every network read.
enum SettingsLoad<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? {
        if case .loaded(let v) = self { return v }
        return nil
    }
}

extension UsageTone {
    var color: Color {
        switch self {
        case .ok: Theme.success
        case .warn: Theme.warning
        case .crit: Theme.error
        }
    }
}

enum SettingsFormat {
    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    /// `5m`, `3h`, `2d` for an epoch-ms stamp; empty when the stamp is missing.
    static func age(since ms: Double, now: Date = Date()) -> String {
        guard ms > 0 else { return "" }
        return TaskListLogic.age(ms: max(0, now.timeIntervalSince1970 * 1000 - ms))
    }
}

/// A mono command the user pastes on the Mac: tap copies it.
struct SettingsCopyCommand: View {
    var command: String
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = command
            copied = true
        } label: {
            HStack {
                Text(command).font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink).textSelection(.enabled)
                Spacer()
                Text(copied ? String(localized: "copied") : String(localized: "copy")).font(Theme.mono(12)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .tile(Theme.inset)
        }
        .buttonStyle(.pressable)
        .accessibilityIdentifier("copyCommand")
    }
}

/// `daemon out of date`, shown only when `daemon.info` says stale.
struct StaleDaemonNotice: View {
    var info: DaemonInfo

    var body: some View {
        FormSection(label: String(localized: "daemon")) {
            VStack(alignment: .leading, spacing: 10) {
                Text("daemon out of date").font(Theme.mono(14, .bold)).foregroundStyle(Theme.warning)
                Text("the daemon on your mac runs v\(info.daemonVersion ?? "?"), this app's bridge runs v\(info.bridgeVersion ?? "?"). restart it on the mac:")
                    .font(Theme.face(15)).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                SettingsCopyCommand(command: "rove daemon restart")
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tile(Theme.warning.opacity(0.10), border: Theme.warning)
            .accessibilityIdentifier("daemonStaleNotice")
        }
    }
}

/// The second confirm every destructive bridge op needs: says what changes, then `PrimaryBar(destructive:)`.
/// `run` throws the bridge's refusal, which lands here as an `ErrorLine`; `failed` lets the caller reload.
struct SettingsConfirmSheet: View {
    var title: String
    var kicker: String
    var prose: String
    var label: String
    var detents: Set<PresentationDetent> = [.medium]
    var run: () async throws -> Void
    var failed: (() async -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        SheetScaffold(title: title, kicker: kicker, error: error,
                      primary: PrimaryBar(label: label, destructive: true, busy: busy,
                                          identifier: "confirmAction") { Task { await go() } }) {
            Text(prose).font(Theme.face(16)).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .presentationDetents(detents)
    }

    private func go() async {
        busy = true
        defer { busy = false }
        do {
            try await run()
            dismiss()
        } catch {
            self.error = error.localizedDescription
            await failed?()
        }
    }
}
