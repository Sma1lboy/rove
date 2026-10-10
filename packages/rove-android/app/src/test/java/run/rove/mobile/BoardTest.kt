package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import run.rove.mobile.domain.*

class BoardTest {
    private fun story(id: Int, status: IssueStatus = IssueStatus.Open, created: String = "2026-01-01", task: String? = null) =
        Story(id, "s$id", status, created, taskId = task)

    @Test fun columnsFollowStatusLinkAndCap() {
        val stories = listOf(
            story(1), story(2, IssueStatus.Doing, task = "T-WAIT"), story(3, task = "T-LIVE"), story(4, task = "T-GONE"),
            story(5, IssueStatus.Hold, task = "T-LIVE"),
        ) + (10..40).map { story(it, IssueStatus.Done, created = "2026-02-%02d".format(it - 9)) }
        val exists: (String) -> Boolean = { it == "T-LIVE" || it == "T-WAIT" }
        val cols = BoardLogic.columns(stories, exists).associateBy { it.key }
        assertEquals(listOf(1, 4), cols.getValue(BoardColumn.Backlog).stories.map { it.id }.sorted())
        assertEquals(listOf(2, 3), cols.getValue(BoardColumn.InProgress).stories.map { it.id }.sorted())
        assertEquals(listOf(5), cols.getValue(BoardColumn.Parked).stories.map { it.id })
        val done = cols.getValue(BoardColumn.Done)
        assertEquals(20, done.stories.size)
        assertEquals(11, done.hiddenCount)
        assertEquals(40, done.stories.first().id)
        // Until the task feed loads, the link alone decides.
        assertEquals(listOf(2, 3, 4), BoardLogic.columns(stories, null).first { it.key == BoardColumn.InProgress }.stories.map { it.id }.sorted())

        val floated = BoardLogic.floatingAttention(BoardLogic.columns(stories, exists)) { it == "T-WAIT" }
        assertEquals(1, floated.count)
        assertEquals(listOf(2, 3), floated.columns.first { it.key == BoardColumn.InProgress }.stories.map { it.id })
    }

    @Test fun storyEditComparesTrimmedAndClearsBody() {
        val original = StoryEdit(Story(7, "Fix it", IssueStatus.Open, body = "why"))
        assertFalse(StoryEdit("Fix it\n", " why ", IssueStatus.Open).isDirty(original))
        assertFalse(StoryEdit("  ", "why", IssueStatus.Open).canSubmit(original))
        assertEquals(StoryUpdate(null, null, true), StoryEdit("Fix it", "  ", IssueStatus.Open).update(original))
        assertEquals(StoryUpdate("New", null, false), StoryEdit(" New ", "why", IssueStatus.Open).update(original))
        assertNull(StoryEdit("Fix it", "why", IssueStatus.Done).update(original))
    }
}
