package run.rove.mobile

import kotlinx.serialization.json.decodeFromJsonElement
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*
import run.rove.mobile.domain.RowMenuItem.*

class TaskRowMenuTest {
    @Test fun aProjectsMainRowCannotBePinnedOrArchived() {
        assertEquals(listOf(Rename, SetStatus), TaskRowMenuLogic.items(TaskRow("m", kind = "main")))
    }
    @Test fun aTaskRowOffersTheOppositeOfItsCurrentState() {
        assertEquals(listOf(Rename, Pin, SetStatus, RenameBranch, Archive), TaskRowMenuLogic.items(TaskRow("t", branch = "b")))
        assertEquals(listOf(Rename, Unpin, SetStatus, Unarchive), TaskRowMenuLogic.items(TaskRow("t", pinned = true, archived = true)))
    }
    @Test fun archivedRowsArriveBesideTasksAndRoutineRunsStayOutOfTheFold() {
        val tasks = wireJson.decodeFromJsonElement<Tasks>(wireJson.parseToJsonElement(
            """{"tasks":[],"archived":[{"id":"a","archived":true},{"id":"r","archived":true,"routine":true}]}"""))
        assertEquals(listOf("a"), TaskRowMenuLogic.archivedFold(tasks.archived).map { it.id })
    }
}
