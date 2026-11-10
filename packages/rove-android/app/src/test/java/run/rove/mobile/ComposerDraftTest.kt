package run.rove.mobile

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import run.rove.mobile.domain.SendReply
import run.rove.mobile.ui.ComposerDraft

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ComposerDraftTest {
    @Test fun deliveredReplyPreservesLaterEdits() = editsDuringReply(SendReply(delivered = true))

    private fun editsDuringReply(reply: SendReply) = runTest {
        for (replacement in listOf("B", "A\n", "A")) {
            val draft = ComposerDraft()
            draft.field = TextFieldValue("A")
            val pending = CompletableDeferred<SendReply>()
            val send = launch {
                draft.send {
                    assertEquals("A", it)
                    pending.await().delivered
                }
            }
            runCurrent()
            draft.field = TextFieldValue("intermediate edit")
            val edited = TextFieldValue(replacement, TextRange(replacement.length))
            draft.field = edited
            pending.complete(reply)
            send.join()
            assertEquals(edited, draft.field)
        }
    }

    @Test fun acceptedUneditedDraftClearsButRefusedDraftStays() = runTest {
        val draft = ComposerDraft()
        draft.field = TextFieldValue("A")
        draft.send { false }
        assertEquals("A", draft.field.text)
        draft.send { true }
        assertEquals("", draft.field.text)
    }
}
