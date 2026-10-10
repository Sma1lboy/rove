package run.rove.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import run.rove.mobile.data.Connection

@Composable fun RoveApp(model: AppModel, pairingUrl: String, onUrl: (String) -> Unit,
                        scan: () -> Unit, notificationPermission: () -> Unit) {
    val paired by model.paired.collectAsStateWithLifecycle()
    val demo by model.demo.collectAsStateWithLifecycle()
    val state by model.bridge.state.collectAsStateWithLifecycle()
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var create by remember { mutableStateOf(false) }
    BackHandler(selected != null) { selected = null }
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        // A focusable root absorbs the initial focus Compose grants in non-touch mode (after any key
        // event), so launching never lands on the pairing field and raises the keyboard.
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().focusable()) {
            if (demo) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("demo · not connected to a mac", style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f).padding(vertical = 12.dp))
                        TextButton(onClick = { model.unpair(); selected = null }) { Text("connect a mac") }
                    }
                }
            }
            if (!paired) PairingScreen(pairingUrl, onUrl, scan, model::pair, model::startDemo)
            else {
                if (state !is Connection.Connected) {
                    Text(when (val s = state) {
                        is Connection.Failed -> s.reason
                        is Connection.Retrying -> "reconnecting · attempt ${s.attempt}"
                        Connection.Connecting -> "connecting"
                        else -> "disconnected"
                    }, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { model.unpair(); selected = null }) { Text("pair again") }
                }
                if (selected == null) TaskListScreen(tasks, onSelect = { selected = it }, onRefresh = model::refresh,
                    onCreate = { create = true }, onDisconnect = { model.unpair() }, onNotify = notificationPermission)
                else TaskDetailScreen(model, selected!!, { selected = null })
            }
        }
        if (create) CreateSheet(model, null, { create = false }, { selected = it; create = false })
        if (error != null) AlertDialog(onDismissRequest = { model.error.value = null },
            title = { Text("Could not complete action") }, text = { Text(error!!) },
            confirmButton = { TextButton(onClick = { model.error.value = null }) { Text("close") } })
    }
}
