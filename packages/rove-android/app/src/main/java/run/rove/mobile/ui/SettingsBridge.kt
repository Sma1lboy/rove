package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.HelloInfo

/** Settings → bridge: this phone's connection to the mac, and where it is disconnected or forgotten. */
@Composable fun BridgeSettings(model: AppModel, back: () -> Unit) {
    val state by model.bridge.state.collectAsStateWithLifecycle()
    val demo by model.demo.collectAsStateWithLifecycle()
    val modelHost by model.host.collectAsStateWithLifecycle()
    var hello by remember { mutableStateOf<HelloInfo?>(null) }
    var confirming by remember { mutableStateOf(false) }
    LaunchedEffect(state) {
        if (state is Connection.Connected) hello = settingsCatching { model.repository.helloInfo() }.getOrNull()
    }
    val dash = "—"
    SettingsPage(stringResource(R.string.settings_bridge), back) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Kicker(stringResource(R.string.settings_bridge_kicker))
            Text(stringResource(R.string.settings_bridge_title), color = Rove.c.ink, style = Rove.face(24, FontWeight.SemiBold))
            Text(stringResource(R.string.settings_bridge_intro), color = Rove.c.ink, style = Rove.face(16))
        }
        FormSection(stringResource(R.string.settings_connection)) {
            Column(Modifier.fillMaxWidth().tile()) {
                SettingsInfoRow(stringResource(R.string.settings_status), settingsConnectionLabel(state).lowercase(),
                    if (state is Connection.Failed) Rove.c.error else Rove.c.ink)
                SettingsDivider()
                SettingsInfoRow(stringResource(R.string.settings_host), hello?.host?.takeIf { it.isNotEmpty() } ?: modelHost.ifEmpty { dash })
                SettingsDivider()
                SettingsInfoRow("rove", hello?.roveVersion?.takeIf { it.isNotEmpty() } ?: dash)
            }
        }
        if (demo) TileLabel(stringResource(R.string.settings_disconnect), onClick = model::unpair)
        else TileLabel(stringResource(R.string.settings_forget), tint = Rove.c.error) { confirming = true }
    }
    if (confirming) SettingsConfirmSheet(stringResource(R.string.settings_forget_title), stringResource(R.string.settings_bridge),
        stringResource(R.string.settings_forget_prose), stringResource(R.string.settings_forget), { confirming = false },
        run = { model.unpair() })
}
