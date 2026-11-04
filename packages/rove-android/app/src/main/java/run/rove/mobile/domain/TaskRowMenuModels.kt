package run.rove.mobile.domain

enum class RowMenuItem { Rename, Pin, Unpin, SetStatus, RenameBranch, Archive, Unarchive }

object TaskRowMenuLogic {
    val STATUSES = listOf("backlog", "in_progress", "in_review", "done", "canceled", "error")

    /** A project's main row is the project itself: it cannot be pinned or archived. */
    fun items(row: TaskRow): List<RowMenuItem> = buildList {
        add(RowMenuItem.Rename)
        if (row.kind != "main") add(if (row.pinned) RowMenuItem.Unpin else RowMenuItem.Pin)
        add(RowMenuItem.SetStatus)
        if (row.branch.isNotEmpty()) add(RowMenuItem.RenameBranch)
        if (row.kind != "main") add(if (row.archived) RowMenuItem.Unarchive else RowMenuItem.Archive)
    }

    /** Routine runs live on the Routines page, archived or not. */
    fun archivedFold(archived: List<TaskRow>) = archived.filterNot { it.routine }
}
