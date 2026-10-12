package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import run.rove.mobile.domain.*
import org.junit.Test

class WorktreesTest {
    private val now = 1_000_000_000_000L
    private fun ago(minutes: Long) = (now - minutes * 60_000).toDouble()

    @Test fun ageUsesTheLargestWholeUnitAndHidesMissingTimestamps() {
        assertEquals(WorktreeAge(1, AgeUnit.Minutes), WorktreesLogic.age(ago(0), now))
        assertEquals(WorktreeAge(59, AgeUnit.Minutes), WorktreesLogic.age(ago(59), now))
        assertEquals(WorktreeAge(3, AgeUnit.Hours), WorktreesLogic.age(ago(190), now))
        assertEquals(WorktreeAge(9, AgeUnit.Days), WorktreesLogic.age(ago(9 * 1440L), now))
        assertEquals(WorktreeAge(3, AgeUnit.Months), WorktreesLogic.age(ago(95 * 1440L), now))
        assertNull(WorktreesLogic.age(0.0, now))
        assertNull(WorktreesLogic.age(null, now))
    }

    @Test fun unknownProbesAreNotReadAsCleanAndVerdictAddsOnlyWhatTagsMiss() {
        val unknown = WorktreeRow(path = "/a", dirty = null, branchOnRemote = null, verdictReason = "fresh")
        assertEquals(listOf(WorktreeTagKind.DirtyUnknown, WorktreeTagKind.RemoteUnknown), WorktreesLogic.tags(unknown).map { it.kind })
        val merged = WorktreeRow(path = "/b", roveManaged = true, dirty = false, branchOnRemote = true, verdictReason = "prMerged")
        assertEquals(listOf(WorktreeTagKind.Rove, WorktreeTagKind.OnRemote, WorktreeTagKind.PrMerged), WorktreesLogic.tags(merged).map { it.kind })
        assertEquals(WorktreeTone.Warn, WorktreesLogic.tags(WorktreeRow(path = "/c", dirty = true, branchOnRemote = false)).first().tone)
    }

    @Test fun onlyATrackedTaskBranchCanLand() {
        assertEquals(true, WorktreeRow(path = "/a", taskId = "T-1", taskKind = "task").canLand)
        assertEquals(false, WorktreeRow(path = "/a", taskId = "T-1", taskKind = "main").canLand)
        assertEquals(false, WorktreeRow(path = "/a").canLand)
        assertEquals("payments-api", WorktreesLogic.projectName("/work/payments-api/"))
    }
}
