package run.rove.mobile.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

/** All callers enqueue on the UI thread, including while a cursor-mode lookup is pending. */
class TerminalInput(
    scope: CoroutineScope,
    private val queryCursorMode: ((Boolean) -> Unit) -> Unit,
    private val send: (String) -> Boolean,
) {
    private val inputScope = CoroutineScope(scope.coroutineContext + Job(scope.coroutineContext[Job]))

    private val mutex = Mutex()

    fun input(text: String, cursorKey: Boolean = false) = inputScope.async(start = CoroutineStart.UNDISPATCHED) {
        mutex.withLock {
            currentCoroutineContext().ensureActive()
            val applicationMode = cursorKey && CursorKeys.isArrow(text) && suspendCancellableCoroutine { continuation ->
                queryCursorMode { continuation.resume(it) }
            }
            send(if (applicationMode) CursorKeys.applicationMode(text) else text)
        }
    }

    fun close() { inputScope.cancel() }
}
