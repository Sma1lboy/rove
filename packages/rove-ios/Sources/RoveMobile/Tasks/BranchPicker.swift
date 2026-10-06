import SwiftUI

/// Base-ref tiles from `repo.branches`; the current branch comes first and is the default.
struct BranchPicker: View {
    var branches: [String]
    @Binding var selection: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            ChoiceTiles(options: branches, selection: $selection, label: { $0 }, fill: false)
        }
        .accessibilityIdentifier("basePicker")
    }
}
