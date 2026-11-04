package run.rove.mobile.data

suspend fun RoveRepository.renameTask(taskId: String, title: String) { bridge.request("task.rename", args("taskId" to taskId, "title" to title)) }
suspend fun RoveRepository.renameBranch(taskId: String, branch: String) { bridge.request("task.setBranch", args("taskId" to taskId, "branch" to branch)) }
suspend fun RoveRepository.pinTask(taskId: String, pinned: Boolean) { bridge.request("task.pin", args("taskId" to taskId, "pinned" to pinned)) }
suspend fun RoveRepository.setTaskStatus(taskId: String, status: String) { bridge.request("task.setStatus", args("taskId" to taskId, "status" to status)) }

/** Archive only hides the row. `force` hides one whose engine is still working, after the owner says so. */
suspend fun RoveRepository.archiveTask(taskId: String, archived: Boolean, force: Boolean = false) {
    bridge.request("task.archive", if (force) args("taskId" to taskId, "archived" to archived, "force" to true) else args("taskId" to taskId, "archived" to archived))
}
