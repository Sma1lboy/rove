package run.rove.mobile

import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.parseToJsonElement
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.data.wireJson
import run.rove.mobile.domain.SearchLogic
import run.rove.mobile.domain.SearchReply

class SearchTest {
    @Test fun readsTheBridgeReplyAndIgnoresFieldsItDoesNotKnow() {
        val raw = """{"query":"retry","matches":[{"taskId":"T1","title":"Fix","tabId":"tab-1","role":"user","at":"2026-11-03T00:00:00Z","snippet":"add retry","extra":1}],
            "skipped":[{"taskId":"T2","reason":"engine-unsupported"}],"truncated":true}"""
        val reply = wireJson.decodeFromJsonElement<SearchReply>(wireJson.parseToJsonElement(raw))
        assertEquals("tab-1", reply.matches.single().tabId)
        assertEquals(1, reply.skipped.size)
        assertEquals(true, reply.truncated)
    }
    @Test fun aDemoOrOldBridgeAnsweringNothingMeansNoHits() {
        assertEquals(SearchReply(), wireJson.decodeFromJsonElement<SearchReply>(wireJson.parseToJsonElement("{}")))
    }
    @Test fun highlightsEveryCaseInsensitiveMatchWithoutOverlap() {
        assertEquals(listOf(0..2, 8..10), SearchLogic.matches("Foo bar foo", "foo"))
        assertEquals(listOf(0..1, 2..3), SearchLogic.matches("aaaa", "aa"))
        assertEquals(emptyList<IntRange>(), SearchLogic.matches("foo", ""))
    }
}
