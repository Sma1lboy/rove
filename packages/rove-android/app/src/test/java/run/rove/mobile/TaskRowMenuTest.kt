package run.rove.mobile

import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*
import run.rove.mobile.domain.RowMenuItem.*

class TaskRowMenuTest {
    @Test fun aProjectsMainRowCanBeArchivedButNotPinnedOrRemoved() {
        assertEquals(listOf(NewConversation, NewShell, Rename, SetStatus, Copy, ChangeEngine, Archive), TaskRowMenuLogic.items(TaskRow("m", kind = "main")))
        assertEquals(Unarchive, TaskRowMenuLogic.items(TaskRow("m", kind = "main", archived = true)).last())
    }
    @Test fun aTaskRowOffersTheOppositeOfItsCurrentState() {
        assertEquals(listOf(NewConversation, NewShell, Rename, Pin, SetStatus, Land, Copy, MoveToProject, ChangeEngine, SyncBase, RenameBranch, Archive, Remove), TaskRowMenuLogic.items(TaskRow("t", branch = "b")))
        assertEquals(listOf(NewConversation, NewShell, Rename, Unpin, SetStatus, Copy, MoveToProject, ChangeEngine, Unarchive, Remove), TaskRowMenuLogic.items(TaskRow("t", pinned = true, archived = true)))
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
    @Test fun aTaskOnAnotherMachineCannotMoveOrChangeEngine() {
        val items = TaskRowMenuLogic.items(TaskRow("t", branch = "b", machine = TaskMachine("mini")))
        assertEquals(false, MoveToProject in items || ChangeEngine in items)
        assertEquals(true, Land in items)
    }
    @Test fun moveToProjectIsOnlyForAPlainTopLevelRow() {
        assertEquals(false, MoveToProject in TaskRowMenuLogic.items(TaskRow("t", parentTaskId = "p")))
        assertEquals(false, MoveToProject in TaskRowMenuLogic.items(TaskRow("t", extraRepoCount = 1)))
    }
    @Test fun moveTargetsLeaveOutTheTasksOwnProjectAndSpellOutSharedNames() {
        val saved = listOf("/a/one", "/a/app", "/b/app", "ssh://mini/c/far")
        assertEquals(listOf(MoveTarget("/a/app", "/a/app"), MoveTarget("/b/app", "/b/app")), TaskRowMenuLogic.moveTargets(TaskRow("t", repo = "/a/one"), saved))
        assertEquals(listOf(MoveTarget("/a/one", "one"), MoveTarget("/b/app", "app")), TaskRowMenuLogic.moveTargets(TaskRow("t", repo = "/a/app"), saved))
    }
    @Test fun aProjectMovesBesideThisMachinesProjectsInListOrder() {
        val sections = listOf(TaskSection("/a", listOf(TaskRow("1", repo = "/a"))), TaskSection("ssh://mini/far", listOf(TaskRow("2", machine = TaskMachine("mini")))),
            TaskSection("/b", listOf(TaskRow("3", repo = "/b"))), TaskSection("/c", listOf(TaskRow("4", repo = "/c"))))
        assertEquals(ProjectMoves(null, null, "/b"), ProjectMoves.of("/a", sections))
        assertEquals(ProjectMoves("/a", "/b", null), ProjectMoves.of("/c", sections))
        assertEquals(ProjectMoves(null, null, null), ProjectMoves.of("ssh://mini/far", sections))
        assertEquals(ProjectMoves(null, null, null), ProjectMoves.of("ssh://mini/far", sections.filter { it.repo.startsWith("ssh://") }))
    }
}
