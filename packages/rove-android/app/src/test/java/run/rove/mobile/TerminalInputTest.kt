package run.rove.mobile

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import run.rove.mobile.ui.TerminalInput

class TerminalInputTest {
    @Test fun arrowLookupCannotBeOvertakenByOtherInput() = runBlocking {
        for (applicationMode in listOf(false, true)) {
            val sent = mutableListOf<String>()
            lateinit var complete: (Boolean) -> Unit
            val input = TerminalInput(this, { complete = it }, { sent.add(it); true })
            val arrow = input.input("\u001b[A", cursorKey = true)
            val following = listOf("\r", "\u001b", "\t", "\u0003", "typed", "yes", "\u001b[200~path\u001b[201~")
            val pending = following.map { input.input(it) }
            assertEquals(emptyList<String>(), sent)
            complete(applicationMode)
            assertTrue(arrow.await())
            pending.forEach { assertTrue(it.await()) }
            assertEquals(listOf(if (applicationMode) "\u001bOA" else "\u001b[A") + following, sent)
            input.close()
        }
    }

    @Test fun closingDropsInputWaitingForMode() = runBlocking {
        val sent = mutableListOf<String>()
        lateinit var complete: (Boolean) -> Unit
        val input = TerminalInput(this, { complete = it }, { sent.add(it); true })
        val arrow = input.input("\u001b[A", cursorKey = true)
        val enter = input.input("\r")
        input.close()
        complete(true)
        arrow.join()
        enter.join()
        assertEquals(emptyList<String>(), sent)
    }
}
