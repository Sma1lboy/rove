package run.rove.mobile

import androidx.compose.ui.text.input.TextFieldValue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.ui.ComposerDraft

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class InboxReplyDraftTest {
    @Test fun trimmedInboxReplyPreservesEditsUntilDelayedDelivery() = runTest {
        val draft = ComposerDraft()
        draft.field = TextFieldValue(" A ")
        val pending = CompletableDeferred<Boolean>()
        val send = launch {
            draft.send { submitted ->
                assertEquals("A", submitted.trim())
                pending.await()
            }
        }
        runCurrent()
        draft.field = TextFieldValue("B")
        pending.complete(true)
        send.join()
        assertEquals("B", draft.field.text)
    }

}
