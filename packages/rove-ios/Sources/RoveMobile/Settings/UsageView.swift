import SwiftUI

/// Quota meters per engine vendor (`usage.get`), the TUI's usage bars.
struct UsageView: View {
    @Environment(AppModel.self) private var model
    @State private var state: SettingsLoad<UsagePayload> = .loading

    var body: some View {
        SettingsPage(title: String(localized: "usage"), refresh: { await load() }) {
            switch state {
            case .loading:
                BrailleSpinner(size: 14)
            case .failed(let message):
                ErrorLine(text: message)
            case .loaded(let payload):
                content(payload)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ payload: UsagePayload) -> some View {
        if let vendors = payload.usage {
            if vendors.isEmpty {
                EmptyState(title: String(localized: "no quota data"), detail: String(localized: "none of your engines report a quota"))
            } else {
                ForEach(vendors) { vendor in
                    FormSection(label: vendor.displayName.lowercased(), trailing: captured(vendor)) {
                        VStack(spacing: 0) {
                            ForEach(Array(vendor.windows.enumerated()), id: \.offset) { index, window in
                                if index > 0 { SettingsDivider() }
                                WindowRow(window: window)
                            }
                        }
                        .tile()
                        .accessibilityIdentifier("usageVendor-\(vendor.vendor)")
                    }
                }
            }
        } else {
            EmptyState(title: String(localized: "no usage yet"), detail: String(localized: "engines report quota once they have run"))
        }
    }

    private func captured(_ vendor: UsageVendor) -> String? {
        let age = SettingsFormat.age(since: vendor.capturedAt)
        return age.isEmpty ? nil : String(localized: "\(age) ago")
    }

    private func load() async {
        do {
            state = .loaded(try await model.client.request("usage.get", as: UsagePayload.self))
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private struct WindowRow: View {
    var window: UsageWindow

    var body: some View {
        let tone = UsageTone.of(percent: window.percent).color
        HStack(spacing: 10) {
            Text(window.label).font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink)
                .frame(width: 34, alignment: .leading)
            Meter(percent: window.percent, tint: tone)
            Text(verbatim: "\(window.percent)%").font(Theme.mono(13, .semibold)).foregroundStyle(tone)
                .frame(width: 44, alignment: .trailing)
            // A fixed column even when empty, so every meter in the group has the same length.
            Text(UsageLogic.resetText(window.resetsAt, now: Date()))
                .font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                .frame(width: 92, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 46)
        .accessibilityElement(children: .combine)
    }
}

/// Inset track, fill capped at 100% in the tone color.
private struct Meter: View {
    var percent: Int
    var tint: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3, style: .continuous).fill(Theme.inset)
                RoundedRectangle(cornerRadius: 3, style: .continuous).fill(tint)
                    .frame(width: geo.size.width * CGFloat(min(max(percent, 0), 100)) / 100)
            }
        }
        .frame(height: 6)
    }
}
