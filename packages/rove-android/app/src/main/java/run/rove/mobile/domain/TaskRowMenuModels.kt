package run.rove.mobile.domain

import kotlinx.serialization.Serializable

@Serializable data class OpenedTab(val tabId: String, val taskId: String? = null)

enum class RowMenuItem { NewConversation, NewShell, Rename, Pin, Unpin, SetStatus, SyncBase, FixChecks, RenameBranch, Archive, Unarchive }

@Serializable data class FixChecksResult(val outcome: String = "", val detail: String? = null)
@Serializable data class SyncResult(val baseRef: String = "", val alreadyCurrent: Boolean = false)

sealed interface SyncRefusal {
    data class Conflict(val files: String) : SyncRefusal
    data class Dirty(val files: String) : SyncRefusal
}

object TaskRowMenuLogic {
    val STATUSES = listOf("backlog", "in_progress", "in_review", "done", "canceled", "error")

    /** A project's main row is the project itself: it cannot be pinned or archived. */
    fun items(row: TaskRow): List<RowMenuItem> = buildList {
        add(RowMenuItem.NewConversation)
        add(RowMenuItem.NewShell)
        add(RowMenuItem.Rename)
        if (row.kind != "main") add(if (row.pinned) RowMenuItem.Unpin else RowMenuItem.Pin)
        add(RowMenuItem.SetStatus)
        // The merge runs on this Mac; another machine's worktree is not here.
        if (row.kind == "task" && row.branch.isNotEmpty() && row.machine == null) add(RowMenuItem.SyncBase)
        if (row.pr?.checkState == "failing") add(RowMenuItem.FixChecks)
        if (row.branch.isNotEmpty()) add(RowMenuItem.RenameBranch)
        if (row.kind != "main") add(if (row.archived) RowMenuItem.Unarchive else RowMenuItem.Archive)
    }

    /** What a failed sync's error names: the daemon spells the two recoverable refusals with a code before the files. */
    fun syncRefusal(detail: String): SyncRefusal? {
        fun files(code: String) = Regex("$code(?:: )?(.*)").find(detail)?.groupValues?.get(1)?.trim()?.ifEmpty { "?" }
        return files("SYNC_CONFLICT")?.let { SyncRefusal.Conflict(it) } ?: files("SYNC_WORKTREE_DIRTY")?.let { SyncRefusal.Dirty(it) }
    }

    /** Routine runs live on the Routines page, archived or not. */
    fun archivedFold(archived: List<TaskRow>) = archived.filterNot { it.routine }
}
