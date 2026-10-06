import SwiftUI

// Temporary entry points while the parity batches land in parallel. Each owner deletes its
// stub line here when the real view (same name) exists. This file is gone when all have landed.

private struct PageStub: View {
    var title: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(back: { dismiss() }) { Text(title).font(Theme.face(16, .semibold)) } trailing: { EmptyView() }
            Spacer()
        }
        .background(Theme.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }
}

struct BoardView: View { var body: some View { PageStub(title: "board") } }
struct RoutinesView: View { var body: some View { PageStub(title: "routines") } }
struct IssuesView: View { var body: some View { PageStub(title: "github issues") } }
struct WorktreesView: View { var body: some View { PageStub(title: "worktrees") } }
struct SettingsView: View { var body: some View { PageStub(title: "settings") } }
