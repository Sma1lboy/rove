package run.rove.mobile

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import run.rove.mobile.domain.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class UpdateSettingsStateTest {
    private fun state() = UpdateSettingsState().apply { loadPrefs(UpdatePrefs()) }

    @Test fun oldChannelResponseCannotReplaceNewerCheck() = runTest {
        val state = state()
        val stable = CompletableDeferred<SettingsLoad<UpdateCheck>>()
        launch { state.checkForUpdate { channel -> assertEquals("latest", channel); stable.await() } }
        runCurrent()
        state.saveChannel("next") {}
        assertNull(state.check.value)
        val next = SettingsLoad.Loaded(UpdateCheck(current = "next"))
        state.checkForUpdate { channel -> assertEquals("next", channel); next }
        stable.complete(SettingsLoad.Loaded(UpdateCheck(current = "stable")))
        runCurrent()
        assertEquals(next, state.check.value)
    }

    @Test fun failedChannelSavePreservesSuccessfulNotifyEditAndInvalidatesCheck() = runTest {
        val state = state()
        val save = CompletableDeferred<Unit>()
        launch { runCatching { state.saveChannel("next") { save.await() } } }
        runCurrent()
        state.saveNotify(false) {}
        val response = CompletableDeferred<SettingsLoad<UpdateCheck>>()
        launch { state.checkForUpdate { response.await() } }
        runCurrent()
        save.completeExceptionally(IllegalStateException("save failed"))
        runCurrent()
        response.complete(SettingsLoad.Loaded(UpdateCheck(current = "next")))
        runCurrent()
        assertEquals(UpdatePrefs("latest", false), state.prefs.value)
        assertNull(state.check.value)
    }

    @Test fun failedNotifySavePreservesSuccessfulChannelEdit() = runTest {
        val state = state()
        val save = CompletableDeferred<Unit>()
        launch { runCatching { state.saveNotify(false) { save.await() } } }
        runCurrent()
        state.saveChannel("next") {}
        save.completeExceptionally(IllegalStateException("save failed"))
        runCurrent()
        assertEquals(UpdatePrefs("next", true), state.prefs.value)
        state.checkForUpdate { channel ->
            assertEquals("next", channel)
            SettingsLoad.Loaded(UpdateCheck())
        }
    }

    @Test fun sameFieldSavesWaitAndRollbackToLastSuccessfulValue() = runTest {
        val state = state()
        val first = CompletableDeferred<Unit>()
        launch { state.saveChannel("next") { first.await() } }
        runCurrent()
        var secondStarted = false
        launch { runCatching { state.saveChannel("nightly") {
            secondStarted = true
            throw IllegalStateException("save failed")
        } } }
        runCurrent()
        assertFalse(secondStarted)
        assertEquals("next", state.prefs.value?.updateChannel)
        first.complete(Unit)
        runCurrent()
        assertTrue(secondStarted)
        assertEquals("next", state.prefs.value?.updateChannel)
    }
}
