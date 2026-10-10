package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import run.rove.mobile.domain.*

class ListHeaderTest {
    private fun row(id: String, repo: String, title: String = id, kind: String = "task", group: String = "idle",
                    rank: Double = 0.0, order: Int? = null, branch: String = "") =
        TaskRow(id = id, title = title, repo = repo, kind = kind, group = group, rank = rank, order = order, branch = branch)

    @Test fun projectOrderFollowsTheSortMode() {
        val rows = listOf(
            row("a-main", "/r/a", kind = "main", order = 2, group = "idle"),
            row("b-main", "/r/b", kind = "main", order = 1, group = "idle"),
            row("a-1", "/r/a", group = "waiting-on-you", order = 3),
        )
        // attention: the project holding the most urgent task leads; default: the project's main task in stored order.
        assertEquals(listOf("/r/a", "/r/b"), TaskListLogic.projects(rows, TaskSortMode.Attention).map { it.repo })
        assertEquals(listOf("/r/b", "/r/a"), TaskListLogic.projects(rows, TaskSortMode.Default).map { it.repo })
        // name: case-insensitive, digit runs numeric.
        val named = listOf(row("x", "/r/a", title = "task 10"), row("y", "/r/a", title = "Task 2"))
        assertEquals(listOf("y", "x"), TaskListLogic.sorted(named, TaskSortMode.Name).map { it.id })
    }

    @Test fun searchScoresEachFieldOnItsOwn() {
        val chat = row("1", "/r/a", title = "feat", branch = "chat")
        // Spending part of the query on the title and the rest on the branch must not match.
        assertNull(RowSearch.score("featchat", chat))
        assertNotNull(RowSearch.score("fe", chat))
    }
}
