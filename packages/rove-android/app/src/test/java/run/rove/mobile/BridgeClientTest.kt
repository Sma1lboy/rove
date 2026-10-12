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
import run.rove.mobile.data.Connection
import java.util.concurrent.TimeUnit

@OptIn(DelicateCoroutinesApi::class, ExperimentalCoroutinesApi::class)
class BridgeClientTest {
    private fun onClient(test: suspend CoroutineScope.(BridgeClient, MockWebServer) -> Unit) = runBlocking {
        newSingleThreadContext("client-test").use { dispatcher ->
            withContext(dispatcher) {
                val server = MockWebServer()
                server.start()
                val http = OkHttpClient.Builder().followRedirects(false).build()
                val client = BridgeClient(this, http)
                try { withTimeout(8_000) { test(client, server) } }
                finally { client.disconnect(); server.close(); http.connectionPool.evictAll(); http.dispatcher.executorService.shutdown() }
            }
        }
    }
    private fun pairing(server: MockWebServer) = Pairing(server.url("/").toString().replace("http://", "ws://"), "fake-test-token")
    private fun socket(closeOnList: Boolean = false) = MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            val request = wireJson.parseToJsonElement(text).jsonObject
            val id = request["id"]!!.jsonPrimitive.long
            val op = request["op"]!!.jsonPrimitive.content
            if (op == "tasks.list" && closeOnList) { webSocket.close(1001, "test restart"); return }
            val result = if (op == "hello") """{"protocol":1,"host":"fixture","roveVersion":"test"}""" else """{"tasks":[],"attention":[]}"""
            webSocket.send("""{"id":$id,"ok":true,"result":$result}""")
        }
    })
    @Test fun actualSocketAuthenticatesAndCorrelatesRequests() = onClient { client, server ->
        server.enqueue(socket())
        client.connect(pairing(server))
        client.state.first { it is Connection.Connected }
        val result = client.request("tasks.list")
        assertEquals(0, result["tasks"]!!.jsonArray.size)
        val upgrade = server.takeRequest(1, TimeUnit.SECONDS)!!
        assertEquals("/", upgrade.path)
        assertEquals("Bearer fake-test-token", upgrade.getHeader("Authorization"))
    }
    @Test fun actualSocketReconnectsWithoutReplayingTheLostRequest() = onClient { client, server ->
        server.enqueue(socket(closeOnList = true)); server.enqueue(socket())
        client.connect(pairing(server))
        val first = client.state.first { it is Connection.Connected }
        try { client.request("tasks.list"); fail("request should fail on disconnect") } catch (_: BridgeFailure) { }
        client.state.first { it is Connection.Connected && it != first }
        assertEquals(2, server.requestCount)
        assertNotNull(client.request("tasks.list")["tasks"])
    }
    @Test fun authorizationFailureDoesNotLoop() = onClient { client, server ->
        server.enqueue(MockResponse().setResponseCode(401))
        client.connect(pairing(server))
        assertTrue(client.state.first { it is Connection.Failed } is Connection.Failed)
        delay(650)
        assertEquals(1, server.requestCount)
    }
    @Test fun manualDisconnectCancelsReconnect() = onClient { client, server ->
        server.enqueue(MockResponse().setResponseCode(503))
        client.connect(pairing(server))
        client.state.first { it is Connection.Retrying }
        client.disconnect()
        delay(650)
        assertEquals(Connection.Disconnected, client.state.value)
        assertEquals(1, server.requestCount)
    }
}
