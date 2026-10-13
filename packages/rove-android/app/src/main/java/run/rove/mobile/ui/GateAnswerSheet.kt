package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BridgeFailure
import run.rove.mobile.data.answerGate
import run.rove.mobile.domain.GateRow

/** iOS `GateAnswerSheet`: the question, one tile per option (the recommended one marked), an optional note; submit sends `gate.answer`. */
@Composable fun GateAnswerSheet(model: AppModel, gate: GateRow, dismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.gate_failed)
    var option by remember(gate.id) { mutableStateOf<String?>(null) }
    var note by remember(gate.id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // A gate with no options is answered by the text alone.
    val ready = !busy && (option != null || note.isNotBlank())

    fun submit() {
        busy = true; error = null
        scope.launch {
            try {
                model.repository.answerGate(gate.id, option, note.trim())
                model.refresh(); dismiss()
            } catch (e: CancellationException) { throw e }
            catch (e: BridgeFailure) { error = "${e.code}: ${e.message}"; model.refresh() }
            catch (_: Exception) { error = failed }
            finally { busy = false }
        }
    }

    SheetScaffold(title = gate.label.ifEmpty { gate.taskId }, onDismiss = { if (!busy) dismiss() },
        kicker = stringResource(R.string.gate_kicker), error = error,
        primary = { PrimaryBar(stringResource(R.string.gate_submit), enabled = ready, busy = busy, onClick = ::submit) }) {
        Text(gate.question, color = Rove.c.ink, style = Rove.face(16, FontWeight.Medium))
        gate.context?.let { Hint(it) }
        if (gate.options.isNotEmpty()) FormSection(stringResource(R.string.gate_options), trailing = "%02d".format(gate.options.size)) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                gate.options.forEach { o ->
                    val on = o.key == option
                    Column(Modifier.fillMaxWidth().selectableTile(on).pressable { option = if (on) null else o.key }
                        .padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(o.key, color = if (on) Rove.c.accent else Rove.c.muted, style = Rove.mono(13, FontWeight.SemiBold))
                            Text(o.label, color = if (on) Rove.c.accent else Rove.c.ink,
                                style = Rove.mono(14, if (on) FontWeight.SemiBold else FontWeight.Medium))
                            if (o.key == gate.recommended) Text(stringResource(R.string.gate_recommended), color = Rove.c.accent, style = Rove.mono(11))
                        }
                        o.detail?.let { Text(it, color = Rove.c.muted, style = Rove.face(13)) }
                    }
                }
            }
        }
        FormSection(stringResource(if (gate.options.isEmpty()) R.string.gate_answer else R.string.gate_note)) {
            PromptEditor(note, { note = it },
                stringResource(if (gate.options.isEmpty()) R.string.gate_answer_placeholder else R.string.gate_note_placeholder), minHeight = 88.dp)
        }
    }
}
