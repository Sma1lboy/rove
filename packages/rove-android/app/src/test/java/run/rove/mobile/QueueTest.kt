package run.rove.mobile

import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.domain.*

class QueueTest {
    @Test fun aSendIsDeliveredHeldOrRefused() {
        assertEquals(SendOutcome.Delivered, QueueLogic.outcome(SendReply(delivered = true)))
        assertEquals(SendOutcome.Queued(2), QueueLogic.outcome(SendReply(queued = true, position = 2)))
        assertEquals(SendOutcome.NotSent("not confirmed"), QueueLogic.outcome(SendReply(reason = "not confirmed")))
    }
    @Test fun chipsListOnlyThisTabInLineOrder() {
        val items = listOf(HeldPrompt("q-1", "tab-1", "a"), HeldPrompt("q-2", "tab-2", "b"), HeldPrompt("q-3", "tab-1", "c"))
        assertEquals(listOf("q-1", "q-3"), QueueLogic.held(items, "tab-1").map { it.id })
    }
}
