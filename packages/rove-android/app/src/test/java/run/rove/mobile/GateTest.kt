package run.rove.mobile

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

@OptIn(DelicateCoroutinesApi::class, ExperimentalCoroutinesApi::class)
class GateTest {
    private val payload = """{"tasks":[],"attention":[
        {"taskId":"T1","tabId":null,"state":"decision_needed","unread":true,"at":5,"gateId":"g-7"}],
        "gates":[{"id":"g-7","taskId":"T1","tabId":null,"question":"Which approach?",
          "options":[{"key":"a","label":"Rewrite","detail":"2 days"},{"key":"b","label":"Patch"}],
          "recommended":"b","status":"open","createdAt":"2026-10-12T00:00:00.000Z","label":"Nightly loop"}]}"""

    @Test fun gatesDecodeAndAnOlderBridgeWithoutThemMeansNone() {
        val tasks = wireJson.decodeFromString<Tasks>(payload)
        val gate = tasks.gates.single()
        assertEquals("b", gate.recommended)
        assertEquals(listOf("a", "b"), gate.options.map { it.key })
        assertEquals("2 days", gate.options.first().detail)
        assertTrue(gate.isOpen)
        assertEquals("g-7", tasks.attention.single().gateId)
        assertEquals(emptyList<GateRow>(), wireJson.decodeFromString<Tasks>("""{"tasks":[],"attention":[]}""").gates)
    }

    @Test fun aDecisionRowIsKeyedByItsGateAndResolvesToIt() {
        val tasks = wireJson.decodeFromString<Tasks>(payload)
        val row = tasks.attention.single()
        assertEquals("gate\u0000g-7", InboxLogic.key(row))
        assertNotEquals(InboxLogic.key(row), InboxLogic.key(row.copy(gateId = "g-8")))
        assertEquals("Which approach?", InboxLogic.gate(row, tasks.gates)?.question)
        assertNull(InboxLogic.gate(row.copy(gateId = "g-9"), tasks.gates))
        assertNull(InboxLogic.gate(row.copy(gateId = null), tasks.gates))
        assertTrue(InboxLogic.isBlocking(row))
    }

    private fun onClient(test: suspend CoroutineScope.(BridgeClient, MockWebServer, MutableList<JsonObject>) -> Unit) = runBlocking {
        newSingleThreadContext("gate-test").use { dispatcher ->
            withContext(dispatcher) {
                val server = MockWebServer()
                server.start()
                val http = OkHttpClient.Builder().followRedirects(false).build()
                val client = BridgeClient(this, http)
                val seen = mutableListOf<JsonObject>()
                server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        val request = wireJson.parseToJsonElement(text).jsonObject
                        val id = request["id"]!!.jsonPrimitive.long
                        val op = request["op"]!!.jsonPrimitive.content
                        seen += request
                        webSocket.send(when (op) {
                            "hello" -> """{"id":$id,"ok":true,"result":{"protocol":1,"host":"fixture","roveVersion":"test"}}"""
                            "gate.answer" -> if (request["args"]!!.jsonObject["gateId"]!!.jsonPrimitive.content == "g-99")
                                """{"id":$id,"ok":false,"error":{"code":"GATE_NOT_FOUND","message":"no gate g-99"}}"""
                            else """{"id":$id,"ok":true,"result":{"delivered":false}}"""
                            else -> """{"id":$id,"ok":true,"result":{}}"""
                        })
                    }
                }))
                try {
                    withTimeout(8_000) {
                        client.connect(Pairing(server.url("/").toString().replace("http://", "ws://"), "fake-test-token"))
                        client.state.first { it is Connection.Connected }
                        test(client, server, seen)
                    }
                } finally { client.disconnect(); server.close(); http.connectionPool.evictAll(); http.dispatcher.executorService.shutdown() }
            }
        }
    }

    @Test fun answeringSendsTheOptionAndNoteAndReportsWhetherTheEngineTookItNow() = onClient { client, _, seen ->
        val delivered = RoveRepository(client).answerGate("g-7", "b", "ship it")
        assertFalse(delivered)
        val sent = seen.last { it["op"]!!.jsonPrimitive.content == "gate.answer" }["args"]!!.jsonObject
        assertEquals(mapOf("gateId" to "g-7", "option" to "b", "text" to "ship it"), sent.mapValues { it.value.jsonPrimitive.content })
    }

    @Test fun aBlankNoteIsNotSentAndAnUnknownGateKeepsTheBridgesCode() = onClient { client, _, seen ->
        val repository = RoveRepository(client)
        repository.answerGate("g-7", "a", "  ")
        val sent = seen.last { it["op"]!!.jsonPrimitive.content == "gate.answer" }["args"]!!.jsonObject
        assertEquals(setOf("gateId", "option"), sent.keys)
        val failure = try { repository.answerGate("g-99", "a", null); null } catch (e: BridgeFailure) { e }
        assertEquals("GATE_NOT_FOUND", failure?.code)
    }
}
