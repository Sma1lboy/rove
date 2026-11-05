package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.OpenedTab
import run.rove.mobile.domain.SyncResult
import run.rove.mobile.domain.FixChecksResult

suspend fun RoveRepository.renameTask(taskId: String, title: String) { bridge.request("task.rename", args("taskId" to taskId, "title" to title)) }
suspend fun RoveRepository.renameBranch(taskId: String, branch: String) { bridge.request("task.setBranch", args("taskId" to taskId, "branch" to branch)) }
suspend fun RoveRepository.pinTask(taskId: String, pinned: Boolean) { bridge.request("task.pin", args("taskId" to taskId, "pinned" to pinned)) }
suspend fun RoveRepository.setTaskStatus(taskId: String, status: String) { bridge.request("task.setStatus", args("taskId" to taskId, "status" to status)) }

/** Archive only hides the row. `force` hides one whose engine is still working, after the owner says so. */
suspend fun RoveRepository.archiveTask(taskId: String, archived: Boolean, force: Boolean = false) {
    bridge.request("task.archive", if (force) args("taskId" to taskId, "archived" to archived, "force" to true) else args("taskId" to taskId, "archived" to archived))
}

/** An engine on the project's last-used engine, the TUI's ctrl+t. In a task that already has a conversation it starts a child task, named by the reply. */
suspend fun RoveRepository.openConversation(taskId: String): OpenedTab = wireJson.decodeFromJsonElement(bridge.request("tab.new", args("taskId" to taskId, "kind" to "engine", "latest" to true)))
suspend fun RoveRepository.openShell(taskId: String): OpenedTab = wireJson.decodeFromJsonElement(bridge.request("tab.new", args("taskId" to taskId, "kind" to "shell")))
suspend fun RoveRepository.syncBase(taskId: String): SyncResult = wireJson.decodeFromJsonElement(bridge.request("task.syncBase", args("taskId" to taskId)))
suspend fun RoveRepository.renameTab(taskId: String, tabId: String, title: String) { bridge.request("tab.rename", args("taskId" to taskId, "tabId" to tabId, "title" to title)) }
suspend fun RoveRepository.closeTab(taskId: String, tabId: String) { bridge.request("tab.close", args("taskId" to taskId, "tabId" to tabId)) }
/** Starts the tab's session again, resuming the engine's conversation where it can. */
suspend fun RoveRepository.reviveTab(taskId: String, tabId: String) { bridge.request("term.revive", args("taskId" to taskId, "tabId" to tabId)) }
suspend fun RoveRepository.fixChecks(taskId: String): FixChecksResult = wireJson.decodeFromJsonElement(bridge.request("task.fixChecks", args("taskId" to taskId)))
