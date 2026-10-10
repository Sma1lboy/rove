package run.rove.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import run.rove.mobile.R

@Composable fun RoveApp(model: AppModel, pairingUrl: String, onUrl: (String) -> Unit,
                        scan: () -> Unit, notificationPermission: () -> Unit) {
    val paired by model.paired.collectAsStateWithLifecycle()
    val demo by model.demo.collectAsStateWithLifecycle()
    val state by model.bridge.state.collectAsStateWithLifecycle()
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val host by model.host.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var create by remember { mutableStateOf(false) }
    val leave = { model.unpair(); selected = null }
    BackHandler(selected != null) { selected = null }
    // A focusable root absorbs the initial focus Compose grants in non-touch mode (after any key
    // event), so launching never lands on the pairing field and raises the keyboard.
    Column(Modifier.fillMaxSize().background(Rove.c.paper).focusable()) {
        // iOS DemoStrip: its inset fill runs up under the status bar.
        if (demo) Column(Modifier.background(Rove.c.inset).windowInsetsPadding(WindowInsets.statusBars)) { DemoStrip(leave) }
        else Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Column(Modifier.weight(1f).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))) {
            if (!paired) PairingScreen(pairingUrl, onUrl, scan, model::pair, model::startDemo)
            else if (selected == null) TaskListScreen(tasks, host, state, demo, onSelect = { selected = it },
                onRefresh = model::refresh, onCreate = { create = true }, onDisconnect = leave,
                onNotify = notificationPermission, onRepair = leave)
            else TaskDetailScreen(model, selected!!, { selected = null })
        }
    }
    if (create) CreateSheet(model, null, { create = false }, { selected = it; create = false })
    if (error != null) AlertDialog(onDismissRequest = { model.error.value = null }, containerColor = Rove.c.paper,
        title = { Text(stringResource(R.string.app_error_title), color = Rove.c.ink, style = Rove.face(17, androidx.compose.ui.text.font.FontWeight.SemiBold)) },
        text = { Text(error!!, color = Rove.c.muted, style = Rove.mono(13)) },
        confirmButton = { TileLabel(stringResource(R.string.app_close), onClick = { model.error.value = null }) })
}
