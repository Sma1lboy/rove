import SwiftUI

private func toneColor(_ tone: RoutineLogic.Tone) -> Color {
    switch tone {
    case .success: Theme.success
    case .muted: Theme.muted
    case .warning: Theme.warning
    case .error: Theme.error
    }
}

/// What agents did in a repo lately: `repo.digest` counts and `turns.list` telemetry.
struct ActivityView: View {
    @Environment(AppModel.self) private var model
    @State private var repos: SettingsLoad<[String]> = .loading
    @State private var repo = ""
    @State private var days = 7
    @State private var digest: SettingsLoad<DigestResult> = .loading
    @State private var turns: SettingsLoad<TurnsResult> = .loading

    var body: some View {
        SettingsPage(title: String(localized: "activity"), refresh: { await reload() }) {
            switch repos {
            case .loading:
                BrailleSpinner(size: 14)
            case .failed(let message):
                ErrorLine(text: message)
            case .loaded(let list):
                if list.isEmpty {
                    EmptyState(title: String(localized: "no repos"), detail: String(localized: "add a repo on the mac to see its activity"))
                } else {
                    pickers(list)
                    digestSection
                    turnsSection
                }
            }
        }
        .task(id: "\(repo)|\(days)") { await reload() }
        .onChange(of: repo) { _, _ in digest = .loading; turns = .loading }
        .onChange(of: days) { _, _ in digest = .loading; turns = .loading }
    }

    // MARK: Pickers

    private func pickers(_ list: [String]) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            FormSection(label: String(localized: "repo")) {
                ScrollView(.horizontal, showsIndicators: false) {
                    ChoiceTiles(options: list, selection: $repo, label: { ($0 as NSString).lastPathComponent }, fill: false)
                }
                .accessibilityIdentifier("activityRepoPicker")
            }
            FormSection(label: String(localized: "window")) {
                ChoiceTiles(options: [7, 14, 30], selection: $days, label: { "\($0)d" })
                    .accessibilityIdentifier("activityWindow")
            }
        }
    }

    // MARK: Digest

    @ViewBuilder private var digestSection: some View {
        FormSection(label: String(localized: "digest")) {
            switch digest {
            case .loading:
                BrailleSpinner(size: 14)
            case .failed(let message):
                ErrorLine(text: message)
            case .loaded(let d):
                VStack(spacing: 0) {
                    SettingsInfoRow(key: String(localized: "tasks touched"), value: "\(d.tasksTotal)")
                    SettingsDivider()
                    SettingsInfoRow(key: String(localized: "routine runs"), value: "\(d.routineRuns)")
                    ForEach(d.byStatus.keys.sorted(), id: \.self) { status in
                        SettingsDivider()
                        SettingsInfoRow(key: status, value: "\(d.byStatus[status] ?? 0)",
                                tint: toneColor(RoutineLogic.tone(status: status)))
                    }
                }
                .tile()
                .accessibilityIdentifier("activityDigest")
            }
        }
    }

    // MARK: Turns

    @ViewBuilder private var turnsSection: some View {
        switch turns {
        case .loading:
            FormSection(label: String(localized: "turns")) { BrailleSpinner(size: 14) }
        case .failed(let message):
            FormSection(label: String(localized: "turns")) { ErrorLine(text: message) }
        case .loaded(let result):
            if result.totals.turns == 0 && result.turns.isEmpty {
                FormSection(label: String(localized: "turns")) {
                    EmptyState(title: String(localized: "no turns recorded"), detail: String(localized: "only some engines report per-turn telemetry"))
                }
            } else {
                FormSection(label: String(localized: "turns")) { totals(result.totals) }
                FormSection(label: String(localized: "latest")) { latest(result.turns) }
            }
        }
    }

    private func totals(_ t: TurnTotals) -> some View {
        VStack(spacing: 0) {
            SettingsInfoRow(key: String(localized: "turns"), value: "\(t.turns)")
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "input"), value: InsightLogic.compact(t.inputTokens))
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "output"), value: InsightLogic.compact(t.outputTokens))
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "cache"), value: InsightLogic.compact(t.cacheReadTokens + t.cacheCreationTokens))
            SettingsDivider()
            SettingsInfoRow(key: String(localized: "time"), value: InsightLogic.duration(ms: t.durationMs))
            ForEach(t.byModel.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }, id: \.key) { entry in
                SettingsDivider()
                SettingsInfoRow(key: entry.key, value: "\(entry.value)")
            }
        }
        .tile()
        .accessibilityIdentifier("activityTurnTotals")
    }

    private func latest(_ all: [TurnRecord]) -> some View {
        let rows = Array(all.sorted { $0.endedAt > $1.endedAt }.prefix(10))
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, turn in
                if index > 0 { SettingsDivider() }
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(turn.model ?? String(localized: "unknown model")).font(Theme.mono(13, .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                        if let vendor = turn.vendor {
                            Text(vendor).font(Theme.mono(11)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 3) {
                        Text(InsightLogic.duration(ms: turn.durationMs)).font(Theme.mono(13)).foregroundStyle(Theme.ink)
                        let age = SettingsFormat.age(since: turn.endedAt)
                        if !age.isEmpty { Text("\(age) ago").font(Theme.mono(11)).foregroundStyle(Theme.muted) }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .accessibilityElement(children: .combine)
            }
        }
        .tile()
        .accessibilityIdentifier("activityLatestTurns")
    }

    // MARK: Loading

    private func loadRepos() async {
        do {
            let list = try await model.client.request("repos.list", as: ReposResult.self).repos
            repos = .loaded(list)
            if repo.isEmpty || !list.contains(repo) {
                repo = model.store.repoFilter.flatMap { list.contains($0) ? $0 : nil } ?? list.first ?? ""
            }
        } catch {
            repos = .failed(error.localizedDescription)
        }
    }

    private func reload() async {
        if repos.value == nil { await loadRepos() }
        guard !repo.isEmpty else { return }
        let (r, d) = (repo, days)
        async let a: Void = loadDigest(repo: r, days: d)
        async let b: Void = loadTurns(repo: r, days: d)
        _ = await (a, b)
    }

    private func loadDigest(repo: String, days: Int) async {
        do {
            let result = try await model.client.request("repo.digest", ["repo": repo, "sinceDays": days], as: DigestResult.self)
            if !Task.isCancelled, repo == self.repo, days == self.days { digest = .loaded(result) }
        } catch {
            if !Task.isCancelled, repo == self.repo, days == self.days { digest = .failed(error.localizedDescription) }
        }
    }

    private func loadTurns(repo: String, days: Int) async {
        do {
            let result = try await model.client.request(
                "turns.list", ["repo": repo, "sinceDays": days, "limit": 50], as: TurnsResult.self)
            if !Task.isCancelled, repo == self.repo, days == self.days { turns = .loaded(result) }
        } catch {
            if !Task.isCancelled, repo == self.repo, days == self.days { turns = .failed(error.localizedDescription) }
        }
    }
}
