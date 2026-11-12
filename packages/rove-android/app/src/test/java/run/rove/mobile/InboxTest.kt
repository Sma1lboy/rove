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

    @Test fun deliveryEpisodesAreKeyedByDeliveryNotTaskTab() {
        val a = Attention(taskId = "a", tabId = null, state = "report_missing", deliveryId = "d-1")
        val b = Attention(taskId = "a", tabId = null, state = "report_missing", deliveryId = "d-2")
        val plain = item("a", "error", 1.0, tab = null)
        assertEquals(3, setOf(InboxLogic.key(a), InboxLogic.key(b), InboxLogic.key(plain)).size)
    }

    @Test fun resumeTimeShowsTheDayOnlyWhenNotToday() {
        val zone = ZoneId.of("UTC")
        val now = Instant.parse("2026-10-10T08:00:00Z")
        assertEquals("3:14 PM", InboxLogic.resumeTime("2026-10-10T15:14:00.000Z", now, zone, Locale.US))
        assertEquals("Oct 11 3:14 PM", InboxLogic.resumeTime("2026-10-11T15:14:00Z", now, zone, Locale.US))
        assertNull(InboxLogic.resumeTime("soon", now, zone, Locale.US))
    }

    @Test fun anUnreportedTickIsClearedOnlyByAnExplicitDismiss() {
        assertEquals(false, InboxLogic.clearsOnVisit(Attention(taskId = "a", state = "report_missing", deliveryId = "d-4")))
        assertEquals(false, InboxLogic.clearsOnVisit(Attention(taskId = "a", state = "decision_needed", gateId = "g-1")))
        assertEquals(true, InboxLogic.clearsOnVisit(item("a", "turn_complete", 1.0)))
        assertEquals(true, InboxLogic.clearsOnVisit(item("a", "error", 1.0)))
    }
    @Test fun aFailedRoutineClearsByItsSchedule() {
        assertEquals("auto-1", InboxLogic.routineEpisode(Attention(state = "routine_failed", automationId = "auto-1")))
        assertNull(InboxLogic.routineEpisode(Attention(taskId = "t", state = "routine_responded", automationId = "auto-1")))
    }
    @Test fun ackAllSkipsDecisionsAndRoutineRowsItCannotKey() {
        fun row(state: String, taskId: String? = "t", gateId: String? = null, automationId: String? = null) =
            Attention(taskId = taskId, state = state, at = 0.0, gateId = gateId, automationId = automationId)
        assertEquals(true, InboxLogic.clearable(row("report_missing")))
        assertEquals(true, InboxLogic.clearable(row("routine_failed", taskId = null, automationId = "a")))
        assertEquals(false, InboxLogic.clearable(row("routine_failed", taskId = null)))
        assertEquals(false, InboxLogic.clearable(row("decision_needed", gateId = "g")))
    }
    @Test fun twoFailedRoutinesWithOneNameKeepTheirOwnRows() {
        fun row(id: String) = Attention(state = "routine_failed", label = "Broken check", automationId = id)
        assertEquals(2, listOf(row("a"), row("b")).distinctBy(InboxLogic::key).size)
    }

    @Test fun aPeekKeepsTheLastRowsWithoutTheBlankScreenAroundThem() {
        val tail = (listOf("", "  ") + (1..14).map { "line $it   " } + listOf("", "")).joinToString("\n")
        val lines = InboxLogic.peekLines(tail)
        assertEquals(InboxLogic.PEEK_LINES, lines.size)
        assertEquals("line 3", lines.first())
        assertEquals("line 14", lines.last())
        assertEquals(emptyList<String>(), InboxLogic.peekLines("\n  \n"))
    }

    @Test fun onlyALocalTabWithoutADecisionIsAnsweredInPlace() {
        val local = TaskRow(id = "a")
        val remote = TaskRow(id = "a", machine = TaskMachine(label = "m"))
        assertEquals(true, InboxLogic.peekable(item("a", "turn_complete", 1.0), local))
        assertEquals(false, InboxLogic.peekable(item("a", "turn_complete", 1.0), remote))
        assertEquals(false, InboxLogic.peekable(item("a", "turn_complete", 1.0, tab = null), local))
        assertEquals(false, InboxLogic.peekable(Attention(taskId = "a", tabId = "tab-1", state = "decision_needed", at = 1.0, gateId = "g"), local))
    }

    @Test fun theTerminalTailDecodesFromTheRowsTheBridgeSends() {
        val env = run.rove.mobile.data.wireJson.decodeFromString<OutputEnvelope>(
            """{"source":"terminal","terminal":{"tail":["$ ls","a.txt"],"truncated":false,"live":true}}""")
        assertEquals("$ ls\na.txt", env.terminal?.tail)
    }
}
