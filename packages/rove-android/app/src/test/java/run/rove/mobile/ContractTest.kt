package run.rove.mobile

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import run.rove.mobile.data.*
import run.rove.mobile.domain.*
import java.net.URLEncoder
import java.util.Base64

class ContractTest {
    @Test fun pairingNeverSendsCredentialsInUrl() {
        val pair = Pairing.parse("wss://rove.example/?token=test-token&preset=cf&route=one", "client", "secret")
        val request = pair.request()
        assertEquals("https://rove.example/?route=one", request.url.toString())
        assertEquals("Bearer test-token", request.header("Authorization"))
        assertEquals("client", request.header("CF-Access-Client-Id"))
        assertEquals("secret", request.header("CF-Access-Client-Secret"))
        assertFalse(pair.toString().contains("test-token"))
    }
    @Test fun wrappedDirectPairingAndUnsafeUrls() {
        val url = "ws://100.70.0.1:7878/?token=abc&preset=tailscale"
        val pair = Pairing.parse("rove://pair?url=" + URLEncoder.encode(url, "UTF-8"))
        assertFalse(pair.cloudflare)
        assertEquals("http://100.70.0.1:7878/", pair.request().url.toString())
        listOf("ws://host/?token=a&preset=cf", "wss://host/?token=a&token=b", "wss://user:pass@host/?token=a",
            "https://host/?token=a", "wss://host/", "wss://host/?token=a&preset=other").forEach {
            assertThrows(IllegalArgumentException::class.java) { Pairing.parse(it) }
        }
        assertThrows(IllegalArgumentException::class.java) { Pairing.parse("wss://host/?token=a&preset=cf").request() }
    }
    @Test fun encodesControlsAndDecodesRepliesAndFutureEvents() {
        val encoded = Protocol.request(7, "term.input", args("stream" to "s", "data" to "a\r\u001b[A"))
        val frame = wireJson.parseToJsonElement(encoded).jsonObject
        assertEquals(7, frame["id"]!!.jsonPrimitive.int)
        assertEquals("a\r\u001b[A", frame["args"]!!.jsonObject["data"]!!.jsonPrimitive.content)
        val success = Protocol.parse("""{"id":7,"ok":true,"result":{"stream":"s"},"future":true}""") as Frame.Reply
        assertEquals("s", success.result!!["stream"]!!.jsonPrimitive.content)
        val failure = Protocol.parse("""{"id":8,"ok":false,"error":{"code":"DIRTY","message":"Refused"}}""") as Frame.Reply
        assertEquals("DIRTY", failure.failure!!.code)
        assertTrue(Protocol.parse("""{"event":"future","data":{}}""") is Frame.Event)
        assertNull(Protocol.parse("""{"id":null,"ok":false}"""))
    }
    @Test fun groupOrderingMatchesIosIncludingMainAndPinnedAndStableTies() {
        val rows = listOf(TaskRow("unknown", group = "future"), TaskRow("idle", group = "idle"),
            TaskRow("work-b", group = "working", rank = 2.0), TaskRow("work-a", group = "working", rank = 1.0),
            TaskRow("review", group = "ready-for-review"), TaskRow("land", group = "landing"),
            TaskRow("wait", group = "waiting-on-you"), TaskRow("pin", group = "idle", pinned = true),
            TaskRow("main", kind = "main", group = "idle"), TaskRow("work-c", group = "working", rank = 2.0))
        assertEquals(listOf("main", "pin", "wait", "land", "review", "work-a", "work-b", "work-c", "idle", "unknown"), TaskOrdering.sorted(rows).map { it.id })
    }
    @Test fun noticesOnlyFollowExistingTaskTransitions() {
        val working = TaskRow("a", title = "Compile", group = "working")
        assertEquals(1, transitionNotices(listOf(working), listOf(working.copy(group = "idle"))).size)
        assertEquals(1, transitionNotices(listOf(working), listOf(working.copy(group = "ready-for-review"))).size)
        assertEquals(1, transitionNotices(listOf(working), listOf(working.copy(group = "waiting-on-you"))).size)
        assertTrue(transitionNotices(null, listOf(working.copy(group = "waiting-on-you"))).isEmpty())
        assertTrue(transitionNotices(listOf(working), listOf(working.copy(group = "idle", deleting = true))).isEmpty())
        assertTrue(transitionNotices(listOf(working), listOf(working)).isEmpty())
    }
    @Test fun sharedIosDemoResolvesAliasesSelectorsBytesAndTime() {
        val raw = checkNotNull(javaClass.classLoader?.getResourceAsStream("demo-fixture.json")).bufferedReader().use { it.readText() }
        val now = java.time.Instant.parse("2026-10-09T12:00:00Z")
        val fixture = DemoFixture(raw) { now }
        val tasks = wireJson.decodeFromJsonElement<Tasks>(fixture.answer("tasks.subscribe"))
        assertTrue(tasks.tasks.any { it.group == "waiting-on-you" })
        assertEquals(tasks, wireJson.decodeFromJsonElement<Tasks>(fixture.answer("tasks.list")))
        val attached = wireJson.decodeFromJsonElement<Attachment>(fixture.answer("term.attach", args("taskId" to "T-WAIT", "tabId" to "tab-1")))
        assertTrue(String(Base64.getDecoder().decode(attached.replay)).contains("Verify refund"))
        val files = wireJson.decodeFromJsonElement<DiffFiles>(fixture.answer("diff.files", args("taskId" to "T-WAIT")))
        assertTrue(files.files.isNotEmpty())
        val file = files.files.first()
        val content = wireJson.decodeFromJsonElement<DiffContent>(fixture.answer("diff.file", args("taskId" to "T-WAIT", "path" to file.path, "scope" to file.scope)))
        assertTrue(content.text!!.contains("diff --git"))
    }
    @Test fun equalDemoAgesTieSoBoardOrderMatchesIos() {
        var clock = java.time.Instant.parse("2026-10-09T12:00:00.100Z")
        val fixture = DemoFixture("""{"x":{"x":[{"a":{"${'$'}ago_min":2880}},{"a":{"${'$'}ago_min":2880}}]}}""") {
            clock.also { clock = clock.plusMillis(7) }
        }
        val stamps = fixture.answer("x").getValue("x").jsonArray.map { it.jsonObject.getValue("a").jsonPrimitive.content }
        assertEquals("2026-10-07T12:00:00Z", stamps[0])
        assertEquals(stamps[0], stamps[1])
    }
    @Test fun reconnectDelayCapsAndAuthorizationStopsRetrying() {
        assertEquals(listOf(500L, 1000L, 2000L, 4000L, 8000L, 16000L, 30000L, 30000L), (0..7).map(Reconnect::delayMs))
        assertFalse(Reconnect.retryable(401)); assertFalse(Reconnect.retryable(403))
        assertTrue(Reconnect.retryable(503)); assertTrue(Reconnect.retryable(null))
    }
    @Test fun listSectionsFollowMostUrgentTaskAndAgeRestartsOnlyWhenRowChanges() {
        val rows = listOf(TaskRow("a-idle", repo = "/w/a", group = "idle"), TaskRow("a-main", repo = "/w/a", kind = "main", group = "idle"),
            TaskRow("b-work", repo = "/w/b", group = "working"), TaskRow("c-wait", repo = "/w/c", group = "waiting-on-you"),
            TaskRow("b-pin", repo = "/w/b", group = "idle", pinned = true), TaskRow("a-land", repo = "/w/a", group = "landing"))
        val sections = TaskOrdering.sections(rows)
        assertEquals(listOf("/w/c", "/w/a", "/w/b"), sections.map { it.repo })
        assertEquals(listOf("c", "a", "b"), sections.map { it.name })
        assertEquals(listOf("a-main", "a-land", "a-idle"), sections[1].rows.map { it.id })
        assertEquals(listOf("b-pin", "b-work"), sections[2].rows.map { it.id })
        assertEquals(listOf("—", "0s", "59s", "1m", "59m", "1h", "23h", "1d"),
            listOf(null, -5.0, 59_999.0, 60_000.0, 3_599_000.0, 3_600_000.0, 86_399_000.0, 86_400_000.0).map(TaskAge::label))
        val row = TaskRow("t", activity = TaskActivity("waiting", 240_000.0))
        val first = TaskAge.receipts(emptyMap(), listOf(row), 1_000)
        assertEquals(244_000.0, TaskAge.ms(first.getValue("t"), 5_000)!!, 0.0)
        assertEquals(first, TaskAge.receipts(first, listOf(row), 9_000))
        assertEquals(9_000L, TaskAge.receipts(first, listOf(row.copy(group = "idle")), 9_000).getValue("t").atMs)
        assertNull(TaskAge.ms(Receipt(TaskRow("n"), 0), 5_000))
    }
}
