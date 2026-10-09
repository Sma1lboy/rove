package run.rove.mobile.ui

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

class TerminalSession(private val bridge: BridgeClient, private val scope: CoroutineScope,
                      private val taskId: String, private val tabId: String,
                      private val write: (String) -> Unit, private val reset: () -> Unit) {
    val status = MutableStateFlow("connecting")
    private var stream: String? = null
    private var cols = 80
    private var rows = 24
    private var fit = true
    private var job: Job? = null
    fun start() {
        job = scope.launch {
            bridge.state.collectLatest { state ->
                stream = null
                if (state !is Connection.Connected) { status.value = "disconnected · input paused"; return@collectLatest }
                // Subscribe before attach: pushes can arrive before the attach response.
                val queued = mutableListOf<TermData>()
                var queuedBytes = 0
                val listen = launch(start = CoroutineStart.UNDISPATCHED) {
                    bridge.events.collect { event ->
                        when (event.name) {
                            "term.data" -> {
                                val data = wireJson.decodeFromJsonElement<TermData>(event.data)
                                if (stream == data.stream) write(data.data)
                                else if (stream == null && queuedBytes < 2_000_000) {
                                    queued.add(data); queuedBytes += data.data.length
                                }
                            }
                            "term.exit" -> {
                                val exit = wireJson.decodeFromJsonElement<TermExit>(event.data)
                                if (stream == exit.stream) { status.value = "session exited (${exit.code ?: "unknown"})"; stream = null }
                            }
                        }
                    }
                }
                try {
                    val params = args("taskId" to taskId, "tabId" to tabId).toMutableMap()
                    if (fit) { params["cols"] = JsonPrimitive(cols); params["rows"] = JsonPrimitive(rows) }
                    val attached = wireJson.decodeFromJsonElement<Attachment>(bridge.request("term.attach", JsonObject(params)))
                    reset(); write(attached.replay)
                    stream = attached.stream
                    queued.filter { it.stream == attached.stream }.forEach { write(it.data) }
                    queued.clear()
                    status.value = if (attached.alive) "connected" else "session ended"
                    if (!attached.alive) stream = null
                    awaitCancellation()
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { status.value = "terminal unavailable · reopen to retry" }
                finally {
                    listen.cancel()
                    stream?.let { bridge.fire("term.detach", args("stream" to it)) }
                    stream = null
                }
            }
        }
    }
    fun input(text: String): Boolean {
        val attached = stream ?: return false
        return bridge.fire("term.input", args("stream" to attached, "data" to text))
    }
    fun resize(columns: Int, lines: Int) {
        cols = columns.coerceIn(10, 1000); rows = lines.coerceIn(4, 500)
        if (fit) stream?.let { bridge.fire("term.resize", args("stream" to it, "cols" to cols, "rows" to rows)) }
    }
    fun setFit(value: Boolean) { fit = value; if (fit) resize(cols, rows) }
    fun close() { job?.cancel() }
}
