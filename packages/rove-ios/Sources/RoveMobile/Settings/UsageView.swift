import SwiftUI

/// Quota meters per engine vendor (`usage.get`), the TUI's usage bars.
struct UsageView: View {
    @Environment(AppModel.self) private var model
    @State private var state: SettingsLoad<UsagePayload> = .loading

    var body: some View {
        SettingsPage(title: "usage", refresh: { await load() }) {
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
                EmptyState(title: "no quota data", detail: "none of your engines report a quota")
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
            EmptyState(title: "no usage yet", detail: "engines report quota once they have run")
        }
    }

    private func captured(_ vendor: UsageVendor) -> String? {
        let age = SettingsFormat.age(since: vendor.capturedAt)
        return age.isEmpty ? nil : "\(age) ago"
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
            Text("\(window.percent)%").font(Theme.mono(13, .semibold)).foregroundStyle(tone)
                .frame(minWidth: 42, alignment: .trailing)
            let reset = UsageLogic.resetText(window.resetsAt, now: Date())
            if !reset.isEmpty {
                Text(reset).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1).fixedSize()
            }
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
