package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.cancelHeld
import run.rove.mobile.data.heldPrompts
import run.rove.mobile.domain.HeldPrompt
import run.rove.mobile.domain.QueueLogic

// packages/rove-web/src/term-queue.tsx: one chip per message held for this tab, in the order they will be pasted.

private const val POLL_MS = 3000L

@Composable fun QueuedChips(model: AppModel, taskId: String, tabId: String, revision: Int) {
    var held by remember(taskId, tabId) { mutableStateOf<List<HeldPrompt>>(emptyList()) }
    var poke by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(taskId, tabId, revision, poke) {
        while (true) {
            // A bridge older than the queue has no `queue.list`: nothing is ever held there.
            held = try { QueueLogic.held(model.repository.heldPrompts(taskId), tabId) }
            catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
            delay(POLL_MS)
        }
    }
    if (held.isEmpty()) return
    val cancel = stringResource(R.string.detail_queue_cancel)
    val chip = stringResource(R.string.detail_queued_chip)
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp).padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        held.forEach { item ->
            Row(Modifier.heightIn(min = 34.dp).tile(radius = Rove.smallRadius).padding(start = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text("$chip · ${QueueLogic.head(item.text)}", color = Rove.c.muted, maxLines = 1, softWrap = false, style = Rove.mono(12))
                Box(Modifier.size(36.dp, 34.dp).pressable {
                    scope.launch {
                        try { model.repository.cancelHeld(item.id) } catch (e: CancellationException) { throw e } catch (_: Exception) {}
                        poke++
                    }
                }.semantics { contentDescription = cancel }, contentAlignment = Alignment.Center) {
                    Text("×", color = Rove.c.muted, style = Rove.mono(15, FontWeight.Medium))
                }
            }
        }
    }
}
