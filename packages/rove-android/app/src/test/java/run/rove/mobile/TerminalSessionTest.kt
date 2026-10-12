package run.rove.mobile

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import run.rove.mobile.data.*

@OptIn(DelicateCoroutinesApi::class, ExperimentalCoroutinesApi::class)
class TerminalSessionTest {
    @Test fun replayLiveInputResizeAndDetachUseTheSameStream() = runBlocking {
        newSingleThreadContext("terminal-test").use { dispatcher -> withContext(dispatcher) {
            val received = mutableListOf<JsonObject>()
            val detached = CompletableDeferred<Unit>()
            val server = MockWebServer()
            server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val frame = wireJson.parseToJsonElement(text).jsonObject
                    synchronized(received) { received.add(frame) }
                    val op = frame["op"]!!.jsonPrimitive.content
                    val id = frame["id"]!!.jsonPrimitive.long
                    val result = when (op) {
                        "hello" -> """{"protocol":1}"""
                        "term.attach" -> {
                            webSocket.send("""{"event":"term.data","data":{"stream":"task::tab-1","data":"bGl2ZQ=="}}""")
                            """{"stream":"task::tab-1","alive":true,"replay":"cmVwbGF5"}"""
                        }
                        else -> "{}"
                    }
                    webSocket.send("""{"id":$id,"ok":true,"result":$result}""")
                    if (op == "term.detach") detached.complete(Unit)
                }
            }))
            server.start()
            val http = OkHttpClient()
            val bridge = BridgeClient(this, http)
            val output = mutableListOf<String>()
            var resets = 0
            val session = TerminalSession(bridge, this, "task", "tab-1", { output.add(it) }, { resets++ })
            try { withTimeout(8_000) {
                assertFalse(session.input("offline"))
                bridge.connect(Pairing(server.url("/").toString().replace("http://", "ws://"), "test-token"))
                bridge.state.first { it is Connection.Connected }
                session.resize(1, 1)
                session.start()
                session.status.first { it == "connected" }
                assertEquals(listOf("cmVwbGF5", "bGl2ZQ=="), output)
                assertEquals(1, resets)
                assertTrue(session.input("hello\r"))
                session.resize(90, 30)
                session.setFit(false)
                session.resize(50, 20)
                session.close()
                detached.await()
                val frames = synchronized(received) { received.toList() }
                val attach = frames.first { it["op"]!!.jsonPrimitive.content == "term.attach" }["args"]!!.jsonObject
                assertEquals(10, attach["cols"]!!.jsonPrimitive.int)
                assertEquals(4, attach["rows"]!!.jsonPrimitive.int)
                val input = frames.first { it["op"]!!.jsonPrimitive.content == "term.input" }["args"]!!.jsonObject
                assertEquals("hello\r", input["data"]!!.jsonPrimitive.content)
                assertEquals("task::tab-1", input["stream"]!!.jsonPrimitive.content)
                val resizes = frames.filter { it["op"]!!.jsonPrimitive.content == "term.resize" }
                assertEquals(1, resizes.size)
                assertEquals(90, resizes[0]["args"]!!.jsonObject["cols"]!!.jsonPrimitive.int)
            } } finally {
                session.close(); bridge.disconnect(); server.close()
                http.connectionPool.evictAll(); http.dispatcher.executorService.shutdown()
            }
        } }
    }
}
