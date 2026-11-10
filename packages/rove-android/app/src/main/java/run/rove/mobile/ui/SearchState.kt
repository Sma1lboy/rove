package run.rove.mobile.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import run.rove.mobile.domain.SearchReply

internal sealed interface SearchState {
    data object Idle : SearchState
    data object Searching : SearchState
    data class Done(val query: String, val reply: SearchReply) : SearchState
    data class Failed(val message: String) : SearchState
}

internal suspend fun searchResult(query: String, request: suspend () -> SearchReply): SearchState = try {
    SearchState.Done(query, request())
} catch (e: TimeoutCancellationException) {
    currentCoroutineContext().ensureActive()
    SearchState.Failed(e.message ?: "Search timed out")
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    SearchState.Failed(e.message ?: e.toString())
}
