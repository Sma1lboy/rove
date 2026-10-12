package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.data.DemoFixture
import run.rove.mobile.data.args
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*
import java.time.Instant

class RoutinesTest {
    @Test fun statusTonesKeepHealthySkipsQuietAndMissedRunsAmber() {
        assertEquals(RoutineLogic.Tone.Success, RoutineLogic.tone("dispatched"))
        assertEquals(RoutineLogic.Tone.Muted, RoutineLogic.tone("skipped_precheck"))
        assertEquals(RoutineLogic.Tone.Warning, RoutineLogic.tone("skipped_missed"))
        assertEquals(RoutineLogic.Tone.Error, RoutineLogic.tone("dispatch_failed"))
        assertEquals(RoutineLogic.Tone.Muted, RoutineLogic.tone("something_new"))
    }

    @Test fun scheduleNeedsFiveCronFieldsHoweverSpacesAreTyped() {
        assertTrue(RoutineLogic.validSchedule(RoutineLogic.normalizeSchedule("  0\t9  *  * MON-FRI ")))
        assertEquals("0 9 * * MON-FRI", RoutineLogic.normalizeSchedule("  0\t9  *  * MON-FRI "))
        assertFalse(RoutineLogic.validSchedule("0 9 * *"))
        assertFalse(RoutineLogic.validSchedule("0 9 * * * *"))
        assertFalse(RoutineLogic.validSchedule("0 9 * * $(id)"))
    }

    @Test fun editSendsOnlyWhatDiffersFromTheSavedRoutine() {
        val saved = Routine(id = "r", name = "audit", prompt = "check", schedule = "0 3 * * *")
        assertTrue(RoutineLogic.changes(saved, " audit ", "check\n", "0  3 * * *").isEmpty())
        assertEquals(mapOf("schedule" to "0 9 * * *"), RoutineLogic.changes(saved, "audit", "check", "0 9 * * *"))
    }

    @Test fun timesCountDownAndAgesNeverGoNegative() {
        val now = Instant.parse("2026-10-10T12:00:00Z")
        assertEquals(3_600_000L, RoutineLogic.untilMs("2026-10-10T13:00:00+00:00", now))
        assertTrue(RoutineLogic.untilMs("2026-10-10T11:00:00Z", now)!! <= 0)
        assertEquals(0L, RoutineLogic.agoMs("2026-10-10T13:00:00Z", now))
        assertNull(RoutineLogic.untilMs(null, now))
        assertNull(RoutineLogic.untilMs("not a time", now))
    }

    @Test fun sparseBridgeRowsDecodeToDefaults() {
        val list = wireJson.decodeFromString<RoutinesPayload>("""{"automations":[{"id":"r-1","repo":"/work/api/","nextRunAt":null}]}""")
        val routine = list.automations.single()
        assertEquals("r-1", routine.name)
        assertEquals("api", routine.repoName)
        assertTrue(routine.enabled)
        assertTrue(list.lastRunStatus.isEmpty())
    }

    @Test fun sharedDemoRoutinesDecodeWithPausedAndFailedRuns() {
        val raw = checkNotNull(javaClass.classLoader?.getResourceAsStream("demo-fixture.json")).bufferedReader().use { it.readText() }
        val fixture = DemoFixture(raw) { Instant.parse("2026-10-10T12:00:00Z") }
        val list = wireJson.decodeFromJsonElement<RoutinesPayload>(fixture.answer("routine.list"))
        assertEquals(RoutineLogic.Tone.Warning, RoutineLogic.tone(list.lastRunStatus.getValue("r-miss")))
        assertFalse(list.automations.single { !it.enabled }.enabled)
        val runs = wireJson.decodeFromJsonElement<RoutineRunsPayload>(fixture.answer("routine.runs", args("id" to "r-ok"))).runs
        assertEquals("T-WORK", runs.first().taskId)
        assertEquals("engine binary not found on PATH", runs.last().error)
    }
}
