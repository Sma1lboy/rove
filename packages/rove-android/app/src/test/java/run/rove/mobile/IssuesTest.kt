package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import run.rove.mobile.domain.*

class IssuesTest {
    @Test fun metaJoinsAuthorAgeAndFirstThreeLabels() {
        val item = WorkItem(1, author = "ana", labels = listOf("bug", "ui", "p1", "extra"))
        assertEquals("ana · 3d ago · [bug] [ui] [p1]", IssueLogic.meta(item, "3d ago"))
        assertEquals("[x]", IssueLogic.meta(WorkItem(2, labels = listOf("x")), null))
    }

    @Test fun ageAndRepoAndFailureKind() {
        val now = java.time.Instant.parse("2026-01-04T00:00:00Z").toEpochMilli()
        assertEquals("3d", IssueLogic.age("2026-01-01T00:00:00Z", now))
        assertNull(IssueLogic.age("", now))
        assertEquals("/b", IssueLogic.currentRepo(listOf("/a", "/b"), "/b"))
        assertEquals("/a", IssueLogic.currentRepo(listOf("/a", "/b"), "/gone"))
        assertEquals("auth", IssueLogic.failureKind("auth: not logged in"))
        assertNull(IssueLogic.failureKind("boom"))
    }
}
