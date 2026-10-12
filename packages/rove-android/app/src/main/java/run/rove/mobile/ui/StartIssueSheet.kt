package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BridgeFailure
import run.rove.mobile.data.builtinEngines
import run.rove.mobile.data.startWorkItem
import run.rove.mobile.domain.IssueEngine
import run.rove.mobile.domain.WorkItem

/** iOS `StartIssueSheet`: `workitem.start`. Built-in engines only; the default engine omits `engine` and leaves it to the mac. */
@Composable fun StartIssueSheet(model: AppModel, repo: String, item: WorkItem, dismiss: () -> Unit, started: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val failed = stringResource(R.string.issues_start_failed)
    var engines by remember { mutableStateOf<List<IssueEngine>>(emptyList()) }
    // null is the default engine: the arg is left out.
    var engine by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            engines = model.repository.builtinEngines()
            if (engine == null) engine = engines.firstOrNull()?.id
        } catch (e: CancellationException) { throw e }
        catch (e: BridgeFailure) { error = "${e.code}: ${e.message}" }
        catch (_: Exception) { error = failed }
        loaded = true
    }

    fun start() {
        busy = true; error = null
        scope.launch {
            try {
                val id = model.repository.startWorkItem(repo, item.number, engine)
                model.refresh(); started(id)
            } catch (e: CancellationException) { throw e }
            catch (e: BridgeFailure) { error = "${e.code}: ${e.message}" }
            catch (_: Exception) { error = failed }
            finally { busy = false }
        }
    }

    SheetScaffold(title = "#${item.number} ${item.title}", onDismiss = { if (!busy) dismiss() },
        kicker = stringResource(R.string.issues_start), error = error,
        primary = { PrimaryBar(stringResource(R.string.issues_start), busy = busy, onClick = ::start) }) {
        FormSection(stringResource(R.string.issues_engine)) {
            if (loaded) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                engines.forEach { EngineTile(it.name.lowercase().ifEmpty { it.id }, engine == it.id) { engine = it.id } }
                EngineTile(stringResource(R.string.issues_default_engine), engine == null) { engine = null }
            } else BrailleSpinner(13)
        }
        Text(stringResource(R.string.issues_start_note), color = Rove.c.ink, style = Rove.face(16))
    }
}

/** Content-sized engine tile (iOS `ChoiceTiles`, `fill: false`). */
@Composable private fun EngineTile(label: String, on: Boolean, onSelect: () -> Unit) {
    Box(Modifier.heightIn(min = 40.dp).selectableTile(on).pressable(onClick = onSelect), contentAlignment = Alignment.Center) {
        Text(label, Modifier.padding(horizontal = 12.dp), color = if (on) Rove.c.accent else Rove.c.ink,
            style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
    }
}
