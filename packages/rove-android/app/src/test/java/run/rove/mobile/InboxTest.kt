package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import run.rove.mobile.domain.*
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

class InboxTest {
    private fun item(task: String?, state: String, at: Double, tab: String? = "tab-1", label: String? = null) =
        Attention(taskId = task, tabId = tab, state = state, at = at, label = label)

    @Test fun blockedEpisodesComeBeforeOlderFinishedTurnsThenTaskOrderBreaksTies() {
        val items = listOf(
            item("a", "turn_complete", 1.0), item("b", "permission_needed", 9.0),
            item("d", "error", 5.0), item("c", "error", 5.0), item(null, "routine_failed", 7.0, tab = null, label = "r"))
        val out = InboxLogic.sorted(items, listOf("c", "d", "b", "a")).map { it.taskId }
        assertEquals(listOf("c", "d", null, "b", "a"), out)
    }

    @Test fun nextWalksOpenableItemsAndWraps() {
        val sorted = listOf(item(null, "routine_failed", 1.0, null, "r"), item("a", "error", 2.0), item("b", "error", 3.0))
        val first = InboxLogic.next(null, sorted)!!
        assertEquals("a", first.taskId)
        val second = InboxLogic.next(InboxLogic.key(first), sorted)!!
        assertEquals("b", second.taskId)
        assertEquals("a", InboxLogic.next(InboxLogic.key(second), sorted)!!.taskId)
        assertNull(InboxLogic.next(null, sorted.take(1)))
    }

    @Test fun recentKeepsNewestPerTabAndSkipsPendingAndDeletedTasks() {
        val visits = listOf(Visit("a", "t1", 1.0), Visit("a", "t1", 5.0), Visit("b", "t1", 4.0),
            Visit("gone", "t1", 9.0), Visit("c", "t2", 3.0), Visit("d", null, 2.0))
        val pending = listOf(item("b", "error", 1.0, tab = null), item("c", "error", 1.0, tab = "t1"))
        val out = InboxLogic.recent(visits, pending, setOf("a", "b", "c", "d"))
        assertEquals(listOf("a" to 5.0, "c" to 3.0, "d" to 2.0), out.map { it.taskId to it.at })
        assertEquals(listOf(5.0, 4.0), InboxLogic.appending(Visit("a", "t1", 5.0), listOf(Visit("a", "t1", 1.0), Visit("b", "t1", 4.0))).map { it.at })
    }

    @Test fun resumeTimeShowsTheDayOnlyWhenNotToday() {
        val zone = ZoneId.of("UTC")
        val now = Instant.parse("2026-10-10T08:00:00Z")
        assertEquals("3:14 PM", InboxLogic.resumeTime("2026-10-10T15:14:00.000Z", now, zone, Locale.US))
        assertEquals("Oct 11 3:14 PM", InboxLogic.resumeTime("2026-10-11T15:14:00Z", now, zone, Locale.US))
        assertNull(InboxLogic.resumeTime("soon", now, zone, Locale.US))
    }
}
