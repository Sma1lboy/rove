package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

private const val PAGE_SIZE = 30

/**
 * iOS `TaskHistorySheet`: a task's engine history (`output.read`), the engine's own transcript when it has one,
 * otherwise a labeled terminal tail.
 */
@Composable fun TaskHistorySheet(model: AppModel, taskId: String, dismiss: () -> Unit) {
    val fallback = stringResource(R.string.history_failed)
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<SettingsLoad<OutputEnvelope>>(SettingsLoad.Loading) }
    var messages by remember { mutableStateOf<List<OutputMessage>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var total by remember { mutableStateOf<Int?>(null) }
    var limited by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var moreError by remember { mutableStateOf<String?>(null) }
    var nothingNewer by remember { mutableStateOf(false) }

    suspend fun load() {
        engineSettingsCall(fallback) { model.repository.readOutput(taskId, PAGE_SIZE) }
            .onSuccess {
                messages = it.history?.messages.orEmpty(); cursor = it.cursor; total = it.history?.totalMessages
                limited = it.history?.limited ?: false; moreError = null; nothingNewer = false
                state = SettingsLoad.Loaded(it)
            }
            .onFailure { state = SettingsLoad.Failed(it.message.orEmpty()) }
    }
    fun loadNewer() {
        val from = cursor ?: return
        if (loadingMore) return
        loadingMore = true; moreError = null; nothingNewer = false
        scope.launch {
            engineSettingsCall(fallback) { model.repository.readOutput(taskId, PAGE_SIZE, from) }
                .onSuccess {
                    val more = it.history?.messages.orEmpty()
                    messages = messages + more; nothingNewer = more.isEmpty()
                    cursor = it.cursor ?: from; total = it.history?.totalMessages ?: total
                    limited = it.history?.limited ?: limited
                    if (it.history != null) state = SettingsLoad.Loaded(it)
                }
                .onFailure { moreError = it.message }
            loadingMore = false
        }
    }
    LaunchedEffect(taskId) { load() }

    SheetScaffold(title = stringResource(R.string.history_title), onDismiss = dismiss, kicker = stringResource(R.string.history_kicker)) {
        when (val s = state) {
            SettingsLoad.Loading -> BrailleSpinner(14)
            is SettingsLoad.Failed -> {
                ErrorLine(s.message)
                RefreshButton { scope.launch { load() } }
            }
            is SettingsLoad.Loaded -> {
                val envelope = s.value
                HistoryHeader(envelope)
                if (envelope.source == "history" && envelope.history != null) {
                    Transcript(messages, total, limited, moreError, hasMore = cursor != null, loadingMore, nothingNewer, ::loadNewer)
                } else TerminalTail(envelope)
                envelope.warnings.forEach { Text(it, color = Rove.c.muted, style = Rove.mono(12)) }
                RefreshButton { scope.launch { load() } }
            }
        }
    }
}

@Composable private fun RefreshButton(onClick: () -> Unit) {
    Row { TileLabel(stringResource(R.string.history_refresh), onClick = onClick) }
}

@Composable private fun HistoryHeader(envelope: OutputEnvelope) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (envelope.running) SettingsTag(stringResource(R.string.history_session_live), Rove.c.success)
        envelope.vendor?.let { SettingsTag(it) }
    }
}

@Composable private fun Transcript(messages: List<OutputMessage>, total: Int?, limited: Boolean, moreError: String?, hasMore: Boolean,
                                   loadingMore: Boolean, nothingNewer: Boolean, loadNewer: () -> Unit) {
    if (messages.isEmpty()) EmptyState(stringResource(R.string.history_empty_title), stringResource(R.string.history_empty_detail))
    else Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        messages.forEachIndexed { index, message ->
            key(index) {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Kicker(stringResource(if (message.role == "user") R.string.history_you else R.string.history_agent))
                    message.blocks.forEachIndexed { i, block -> key(i) { HistoryBlock(block) } }
                }
            }
        }
    }
    val counts = if (total != null) stringResource(R.string.history_counts_total, messages.size, total)
        else stringResource(R.string.history_counts, messages.size)
    Text(if (limited) counts + " · " + stringResource(R.string.history_limited) else counts, color = Rove.c.muted, style = Rove.mono(11))
    moreError?.let { ErrorLine(it) }
    if (hasMore) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        TileLabel(stringResource(R.string.history_load_newer)) { if (!loadingMore) loadNewer() }
        if (loadingMore) BrailleSpinner(13)
    }
    if (nothingNewer) Text(stringResource(R.string.history_nothing_newer), color = Rove.c.muted, style = Rove.mono(11))
}

@Composable private fun TerminalTail(envelope: OutputEnvelope) {
    val tail = envelope.terminal
    val flags = tail?.let {
        listOfNotNull(
            if (it.live) stringResource(R.string.history_flag_live) else null,
            if (it.truncated) stringResource(R.string.history_flag_truncated) else null,
        ).joinToString(" · ").ifEmpty { null }
    }
    FormSection(stringResource(R.string.history_terminal_section), trailing = flags) {
        envelope.fallbackReason?.takeIf { it.isNotEmpty() }?.let { Text(it, color = Rove.c.muted, style = Rove.mono(12)) }
        if (tail != null && tail.tail.isNotEmpty()) SelectionContainer {
            Text(tail.tail, Modifier.fillMaxWidth().tile().padding(12.dp), color = Rove.c.muted, style = Rove.mono(12))
        } else EmptyState(stringResource(R.string.history_nothing_title), stringResource(R.string.history_nothing_detail))
    }
}

/** One block of a message: prose, a tool call, or a tool result that expands on tap. */
@Composable private fun HistoryBlock(block: OutputBlock) {
    when (block.type) {
        "text" -> SelectionContainer { Text(block.text.orEmpty(), color = Rove.c.ink, style = Rove.face(15)) }
        "tool_call" -> Column(Modifier.fillMaxWidth().tile(Rove.c.inset).padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(block.name ?: stringResource(R.string.history_tool), color = Rove.c.ink, style = Rove.mono(12, FontWeight.Bold))
            block.input?.takeIf { it.isNotEmpty() }?.let {
                Text(it, color = Rove.c.ink, style = Rove.mono(12), maxLines = 4)
            }
        }
        "tool_result" -> {
            var expanded by remember { mutableStateOf(false) }
            val text = block.output ?: block.text ?: ""
            val state = stringResource(if (expanded) R.string.history_expanded else R.string.history_collapsed)
            Text(text.ifEmpty { stringResource(R.string.history_empty_result) }, Modifier.fillMaxWidth().tile()
                .pressable { expanded = !expanded }.semantics { stateDescription = state }.padding(10.dp),
                color = Rove.c.muted, style = Rove.mono(12), maxLines = if (expanded) Int.MAX_VALUE else 6)
        }
        else -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(block.type, color = Rove.c.muted, style = Rove.mono(11, FontWeight.Medium))
            (block.text ?: block.output)?.takeIf { it.isNotEmpty() }?.let {
                Text(it, color = Rove.c.muted, style = Rove.mono(12), maxLines = 6)
            }
        }
    }
}
