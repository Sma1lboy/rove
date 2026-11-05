package run.rove.mobile

import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*
import run.rove.mobile.domain.RowMenuItem.*

class TaskRowMenuTest {
    @Test fun aProjectsMainRowCannotBePinnedOrArchived() {
        assertEquals(listOf(NewConversation, NewShell, Rename, SetStatus), TaskRowMenuLogic.items(TaskRow("m", kind = "main")))
    }
    @Test fun aTaskRowOffersTheOppositeOfItsCurrentState() {
        assertEquals(listOf(NewConversation, NewShell, Rename, Pin, SetStatus, SyncBase, RenameBranch, Archive), TaskRowMenuLogic.items(TaskRow("t", branch = "b")))
        assertEquals(listOf(NewConversation, NewShell, Rename, Unpin, SetStatus, Unarchive), TaskRowMenuLogic.items(TaskRow("t", pinned = true, archived = true)))
    }
    @Test fun aTabIsAtAMenuOnlyWhenTheDaemonSaysItNeedsInput() {
        val row = wireJson.decodeFromJsonElement<TaskRow>(wireJson.parseToJsonElement(
            """{"id":"t","tabStatus":{"tab-1":{"kind":"needs-input"},"tab-2":{"kind":"working"}}}"""))
        assertEquals(listOf(true, false, false), listOf("tab-1", "tab-2", "tab-3").map(row::atMenu))
    }
    @Test fun syncIsOnlyForALocalTaskOnABranch() {
        assertEquals(false, SyncBase in TaskRowMenuLogic.items(TaskRow("m", kind = "main", branch = "main")))
        assertEquals(false, SyncBase in TaskRowMenuLogic.items(TaskRow("t", branch = "b", machine = TaskMachine("mini"))))
    }
    @Test fun aSyncRefusalNamesItsFiles() {
        assertEquals(SyncRefusal.Conflict("a.kt, b.kt"), TaskRowMenuLogic.syncRefusal("INTERNAL: SYNC_CONFLICT: a.kt, b.kt"))
        assertEquals(SyncRefusal.Dirty("a.kt"), TaskRowMenuLogic.syncRefusal("INTERNAL: SYNC_WORKTREE_DIRTY: a.kt"))
        assertEquals(null, TaskRowMenuLogic.syncRefusal("INTERNAL: no remote"))
    }
    @Test fun fixChecksShowsOnlyWhileThePrIsRed() {
        fun row(state: String) = TaskRow("t", pr = TaskPR(checkState = state))
        assertEquals(true, FixChecks in TaskRowMenuLogic.items(row("failing")))
        assertEquals(false, FixChecks in TaskRowMenuLogic.items(row("passing")))
    }
    @Test fun archivedRowsArriveBesideTasksAndRoutineRunsStayOutOfTheFold() {
        val tasks = wireJson.decodeFromJsonElement<Tasks>(wireJson.parseToJsonElement(
            """{"tasks":[],"archived":[{"id":"a","archived":true},{"id":"r","archived":true,"routine":true}]}"""))
        assertEquals(listOf("a"), TaskRowMenuLogic.archivedFold(tasks.archived).map { it.id })
    }
}
