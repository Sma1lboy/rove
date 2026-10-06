import SwiftUI

/// `feedback.send` returns arbitrary JSON; only a `url` is worth showing, and anything else decodes to nil.
struct FeedbackResult: Decodable {
    var url: String?

    private enum Keys: String, CodingKey { case url }

    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: Keys.self)
        url = (try? container?.decodeIfPresent(String.self, forKey: .url)) ?? nil
    }
}

/// A public GitHub Discussion in the rove repo, posted from the mac's `gh` login.
struct FeedbackView: View {
    @Environment(AppModel.self) private var model
    @State private var title = ""
    @State private var message = ""
    @State private var confirming = false
    @State private var sent: FeedbackResult?

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var ready: Bool {
        !trimmedTitle.isEmpty && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        SettingsPage(title: String(localized: "feedback")) {
            if let sent {
                sentState(sent)
            } else {
                FormSection(label: String(localized: "title"), trailing: "\(title.count)/200") {
                    FieldBox { TextField("what is this about", text: $title) }
                        .accessibilityIdentifier("feedbackTitle")
                }
                FormSection(label: String(localized: "message"), trailing: "\(message.count)/10000") {
                    PromptEditor(text: $message, placeholder: String(localized: "what happened, or what would you change"), minHeight: 160)
                        .accessibilityIdentifier("feedbackBody")
                }
                Hint(text: String(localized: "it is posted publicly in the rove repo, using the github login on your mac"))
                PrimaryBar(label: String(localized: "send feedback"), enabled: ready && title.count <= 200 && message.count <= 10_000,
                           identifier: "feedbackSend") { confirming = true }
            }
        }
        .sheet(isPresented: $confirming) {
            SettingsConfirmSheet(title: String(localized: "post this feedback?"), kicker: String(localized: "feedback"),
                         prose: String(localized: "Posts a public GitHub Discussion in the rove repo, from your mac's gh login. It can't be unsent."),
                         label: String(localized: "post discussion"), run: {
                sent = try await model.client.request(
                    "feedback.send", ["title": trimmedTitle, "body": message], as: FeedbackResult.self)
            })
        }
    }

    private func sentState(_ result: FeedbackResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("sent").font(Theme.mono(14, .bold)).foregroundStyle(Theme.success)
                .accessibilityIdentifier("feedbackSent")
            if let raw = result.url, let url = URL(string: raw) {
                Link(destination: url) {
                    Text(raw).font(Theme.mono(12)).foregroundStyle(Theme.accent)
                        .multilineTextAlignment(.leading)
                }
            }
            Button {
                title = ""
                message = ""
                sent = nil
            } label: { TileLabel(text: String(localized: "write another")) }
                .buttonStyle(.pressable)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tile()
    }
}
