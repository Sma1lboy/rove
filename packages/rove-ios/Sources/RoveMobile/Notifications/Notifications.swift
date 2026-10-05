import Foundation
import UserNotifications

struct TaskNotice: Equatable {
    enum Kind: Equatable { case waitingOnYou, finished }
    var taskId: String
    var title: String
    var kind: Kind

    var body: String {
        switch kind {
        case .waitingOnYou: "\(title) is waiting on you"
        case .finished: "\(title) finished working"
        }
    }
}

enum TransitionRule {
    /// Notice for a single row's change. Rows that didn't exist before never notify.
    static func notice(old: TaskRow?, new: TaskRow) -> TaskNotice? {
        guard let old, !new.deleting else { return nil }
        if new.group == .waitingOnYou && old.group != .waitingOnYou {
            return TaskNotice(taskId: new.id, title: new.displayTitle, kind: .waitingOnYou)
        }
        if old.group == .working && (new.group == .readyForReview || new.group == .idle) {
            return TaskNotice(taskId: new.id, title: new.displayTitle, kind: .finished)
        }
        return nil
    }

    /// Notices for a whole snapshot. A nil `old` (first snapshot) yields nothing.
    static func notices(old: [TaskRow]?, new: [TaskRow]) -> [TaskNotice] {
        guard let old else { return [] }
        let before = Dictionary(old.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return new.compactMap { notice(old: before[$0.id], new: $0) }
    }
}

@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()

    override init() {
        super.init()
        center.delegate = self
    }

    func requestPermission() {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func post(_ notice: TaskNotice) {
        let content = UNMutableNotificationContent()
        content.title = "Rove"
        content.body = notice.body
        content.sound = .default
        content.userInfo = ["taskId": notice.taskId]
        let req = UNNotificationRequest(identifier: "\(notice.taskId)-\(notice.kind)-\(Date().timeIntervalSince1970)",
                                        content: content, trigger: nil)
        center.add(req)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }
}
