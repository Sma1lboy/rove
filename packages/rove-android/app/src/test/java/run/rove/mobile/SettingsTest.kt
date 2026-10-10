package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.*
import java.time.ZoneId

class SettingsTest {
    @Test fun usageTonesAndSummaryPickTheTightestWindow() {
        assertEquals(listOf(UsageTone.Ok, UsageTone.Warn, UsageTone.Warn, UsageTone.Crit),
            listOf(74, 75, 94, 95).map(UsageTone::of))
        val vendors = listOf(
            UsageVendor("claude", "Claude", windows = listOf(UsageWindow(percent = 42), UsageWindow(percent = 81))),
            UsageVendor("codex", windows = listOf(UsageWindow(percent = 97))),
            UsageVendor("empty"))
        assertEquals("codex" to 97, UsageLogic.tightest(vendors))
        assertEquals("claude" to 81, UsageLogic.tightest(vendors.take(1)))
    }

    @Test fun resetStampsAndCountersFormatLikeTheTui() {
        val utc = ZoneId.of("UTC")
        val now = 1_700_000_000_000L // 2023-11-14 22:13:20 UTC
        assertEquals("→ 23:13", UsageLogic.resetText(now + 3_600_000.0, now, utc))
        assertEquals("→ 11/16 22:13", UsageLogic.resetText(now + 2 * 86_400_000.0, now, utc))
        assertEquals("", UsageLogic.resetText(now - 1.0, now, utc))
        assertEquals("", UsageLogic.resetText(null, now, utc))
        assertEquals(listOf("999", "1.2k", "48k", "3.4m"), listOf(999, 1_234, 48_000, 3_400_000).map(SettingsFormat::compact))
        assertEquals(listOf("9s", "4m07s", "2h03m", "3d"), listOf(9_000.0, 247_000.0, 7_380_000.0, 259_200_000.0).map(SettingsFormat::duration))
    }

    @Test fun olderBridgesDecodeToDefaultsInsteadOfFailing() {
        val digest = wireJson.decodeFromString<DigestResult>("""{"repo":"/r","routines":{"runs":3}}""")
        assertEquals(0, digest.tasks.total)
        assertEquals(3, digest.routines.runs)
        val usage = wireJson.decodeFromString<UsagePayload>("""{"usage":[{"vendor":"x","windows":[{"kind":"week","percent":5}]}]}""")
        assertEquals("week", usage.usage!!.single().windows.single().display)
        assertEquals(StatusTone.Error, SettingsFormat.statusTone("dispatch_failed"))
    }
}
