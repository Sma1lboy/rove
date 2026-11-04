package run.rove.mobile

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import run.rove.mobile.ui.SearchState
import run.rove.mobile.ui.searchResult

class SearchCancellationTest {
    @Test fun requestTimeoutBecomesVisibleFailure() = runTest {
        val state = searchResult("retry") {
            withTimeout(30_000) { awaitCancellation() }
        }
        assertTrue(state is SearchState.Failed)
        assertTrue((state as SearchState.Failed).message.isNotBlank())
    }

    @Test fun cancelledEffectDoesNotPublishFailure() = runTest {
        var state: SearchState = SearchState.Searching
        val started = CompletableDeferred<Unit>()
        val effect = launch {
            state = searchResult("retry") {
                started.complete(Unit)
                awaitCancellation()
            }
        }
        started.await()
        effect.cancelAndJoin()
        assertEquals(SearchState.Searching, state)
        assertTrue(effect.isCancelled)
    }

    @Test fun enclosingTimeoutStillCancelsEffect() = runTest {
        var state: SearchState = SearchState.Searching
        val effect = launch {
            withTimeout(10) {
                state = searchResult("retry") { awaitCancellation() }
            }
        }
        effect.join()
        assertEquals(SearchState.Searching, state)
        assertTrue(effect.isCancelled)
    }
}
