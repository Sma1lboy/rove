package run.rove.mobile.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import okhttp3.*
import run.rove.mobile.domain.Reconnect
import java.util.concurrent.TimeUnit

sealed interface Connection {
    data object Disconnected : Connection
    data object Connecting : Connection
    data class Connected(val generation: Long) : Connection
    data class Retrying(val attempt: Int) : Connection
    data class Failed(val reason: String) : Connection
}

// All methods and callbacks are serialized on the owning Main scope.
class BridgeClient(private val scope: CoroutineScope,
                   private val client: OkHttpClient = OkHttpClient.Builder()
                       .pingInterval(20, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()) {
    val state = MutableStateFlow<Connection>(Connection.Disconnected)
    private val mutableEvents = MutableSharedFlow<Frame.Event>(extraBufferCapacity = 128)
    val events = mutableEvents.asSharedFlow()
    private val pending = mutableMapOf<Long, CompletableDeferred<JsonObject>>()
    private var nextId = 1L
    private var generation = 0L
    private var socket: WebSocket? = null
    private var runner: Job? = null
    private var demo: DemoFixture? = null

    fun connect(pairing: Pairing) {
        disconnect()
        val request = pairing.request()
        val owner = generation
        runner = scope.launch {
            var attempt = 0
            while (isActive && owner == generation) {
                state.value = if (attempt == 0) Connection.Connecting else Connection.Retrying(attempt)
                val opened = CompletableDeferred<Unit>()
                val closed = CompletableDeferred<Int?>()
                val ws = client.newWebSocket(request, object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        scope.launch { if (owner == generation) opened.complete(Unit) }
                    }
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        scope.launch {
                            if (owner != generation || socket !== webSocket) return@launch
                            try {
                                when (val frame = Protocol.parse(text)) {
                                    is Frame.Reply -> {
                                        val waiter = pending.remove(frame.id)
                                        if (waiter != null) {
                                            if (frame.failure != null) waiter.completeExceptionally(frame.failure)
                                            else waiter.complete(frame.result ?: JsonObject(emptyMap()))
                                        } else if (frame.failure != null) {
                                            mutableEvents.emit(Frame.Event("request.error", args("code" to frame.failure.code)))
                                        }
                                    }
                                    is Frame.Event -> mutableEvents.emit(frame)
                                    null -> Unit
                                }
                            } catch (_: Exception) { closed.complete(null) }
                        }
                    }
                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        webSocket.close(code, null)
                        scope.launch { closed.complete(null) }
                    }
                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        scope.launch { closed.complete(null) }
                    }
                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        scope.launch {
                            closed.complete(response?.code)
                            opened.completeExceptionally(BridgeFailure("CONNECT", "Connection failed"))
                        }
                    }
                })
                socket = ws
                var status: Int? = null
                var protocolMismatch = false
                val watchClose = launch {
                    closed.await()
                    if (socket === ws) failPending()
                }
                try {
                    withTimeout(15_000) { opened.await() }
                    val hello = request("hello")
                    if (hello["protocol"]?.jsonPrimitive?.intOrNull != 1) {
                        protocolMismatch = true
                    } else {
                        attempt = 0
                        state.value = Connection.Connected(nextId++)
                        status = closed.await()
                    }
                } catch (e: CancellationException) {
                    if (e !is TimeoutCancellationException) throw e
                } catch (_: Exception) {
                    if (closed.isCompleted) status = closed.await()
                } finally {
                    watchClose.cancel()
                    ws.cancel()
                    if (socket === ws) { socket = null; failPending() }
                }
                if (owner != generation) return@launch
                if (protocolMismatch || !Reconnect.retryable(status)) {
                    state.value = Connection.Failed(if (protocolMismatch) "Unsupported bridge protocol" else
                        "Pairing refused. Check the bridge token and Cloudflare Access credentials.")
                    return@launch
                }
                state.value = Connection.Retrying(++attempt)
                delay(Reconnect.delayMs(attempt - 1))
            }
        }
    }

    fun connectDemo(fixture: DemoFixture) {
        disconnect()
        demo = fixture
        state.value = Connection.Connected(nextId++)
    }

    fun disconnect() {
        generation++
        runner?.cancel(); runner = null
        socket?.cancel(); socket = null
        demo = null
        failPending()
        state.value = Connection.Disconnected
    }

    suspend fun request(op: String, args: JsonObject = JsonObject(emptyMap())): JsonObject {
        demo?.let { return it.answer(op, args) }
        val ws = socket ?: throw BridgeFailure("DISCONNECTED", "Not connected")
        val id = nextId++
        val reply = CompletableDeferred<JsonObject>()
        pending[id] = reply
        try {
            if (!ws.send(Protocol.request(id, op, args))) throw BridgeFailure("SEND", "Connection closed")
            return withTimeout(30_000) { reply.await() }
        } finally { pending.remove(id) }
    }

    fun fire(op: String, args: JsonObject): Boolean {
        if (demo != null) return true
        val ws = socket ?: return false
        if (!ws.send(Protocol.request(nextId++, op, args))) {
            state.value = Connection.Failed("Connection closed; reconnect before typing")
            return false
        }
        return true
    }

    private fun failPending() {
        val waiting = pending.values.toList()
        pending.clear()
        waiting.forEach { it.completeExceptionally(BridgeFailure("DISCONNECTED", "Connection lost. Check before retrying an action.")) }
    }
}
