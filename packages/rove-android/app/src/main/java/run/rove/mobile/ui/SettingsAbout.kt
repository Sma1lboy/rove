package run.rove.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

/** A bundled third-party license: the display name (a proper noun, not translated) and its asset. */
private class License(val name: Int, val asset: String)

private val Licenses = listOf(
    License(R.string.settings_license_maple, "terminal/fonts/OFL.txt"),
    License(R.string.settings_license_jetbrains, "licenses/jetbrains-mono-OFL.txt"),
    License(R.string.settings_license_xterm, "terminal/licenses/xterm.txt"),
    License(R.string.settings_license_addon_fit, "terminal/licenses/addon-fit.txt"),
)

/** Versions, the host, and the licenses of what the app ships. */
@Composable fun AboutSettings(model: AppModel, back: () -> Unit) {
    val context = LocalContext.current
    var license by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(license != null) { license = null }
    license?.let { asset ->
        val entry = Licenses.first { it.asset == asset }
        LicensePage(stringResource(entry.name), asset) { license = null }
        return
    }

    var daemon by remember { mutableStateOf<SettingsLoad<DaemonInfo>>(SettingsLoad.Loading) }
    var hello by remember { mutableStateOf<HelloInfo?>(null) }
    // The terminal licenses are generated at build time; a missing file means no row rather than a dead one.
    val shipped = remember { Licenses.filter { l -> runCatching { context.assets.open(l.asset).close() }.isSuccess } }
    suspend fun load() {
        daemon = settingsCatching { model.repository.daemonInfo() }.toLoad()
        hello = settingsCatching { model.repository.helloInfo() }.getOrNull()
    }
    LaunchedEffect(Unit) { load() }

    val dash = "—"
    val info = daemon.value
    val daemonVersion = when (daemon) {
        SettingsLoad.Loading -> "…"
        is SettingsLoad.Failed -> dash
        is SettingsLoad.Loaded -> info?.daemonVersion?.let { "v$it" } ?: dash
    }
    SettingsPage(stringResource(R.string.settings_about), back, refresh = { load() }) {
        if (info != null && info.stale) StaleDaemonNotice(info)
        Column(Modifier.fillMaxWidth().tile()) {
            SettingsInfoRow(stringResource(R.string.settings_app), rememberAppVersion())
            SettingsDivider()
            SettingsInfoRow(stringResource(R.string.settings_bridge), hello?.roveVersion?.takeIf { it.isNotEmpty() }?.let { "v$it" } ?: dash)
            SettingsDivider()
            SettingsInfoRow(stringResource(R.string.settings_daemon), daemonVersion)
            SettingsDivider()
            SettingsInfoRow(stringResource(R.string.settings_host), hello?.host?.takeIf { it.isNotEmpty() } ?: dash)
            SettingsDivider()
            SettingsInfoRow(stringResource(R.string.settings_uptime), info?.uptimeMs?.let(SettingsFormat::duration) ?: dash)
            SettingsDivider()
            SettingsInfoRow(stringResource(R.string.settings_tasks), info?.taskCount?.toString() ?: dash)
        }
        (daemon as? SettingsLoad.Failed)?.let { ErrorLine(it.message) }
        Hint(stringResource(R.string.settings_about_language))
        Hint(stringResource(R.string.settings_about_mac_side))
        if (shipped.isNotEmpty()) FormSection(stringResource(R.string.settings_licenses)) {
            Column(Modifier.fillMaxWidth().tile()) {
                shipped.forEachIndexed { index, entry ->
                    if (index > 0) SettingsDivider()
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).pressable { license = entry.asset }.padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(entry.name), Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(14, FontWeight.Medium))
                        Text("›", color = Rove.c.muted, style = Rove.mono(14))
                    }
                }
            }
        }
    }
}

@Composable private fun LicensePage(title: String, asset: String, back: () -> Unit) {
    val context = LocalContext.current
    val text = remember(asset) {
        runCatching { context.assets.open(asset).bufferedReader().use { it.readText() } }.getOrDefault("")
    }
    SettingsPage(title, back) {
        SelectionContainer { Text(text.trim(), color = Rove.c.ink, style = Rove.mono(11)) }
    }
}
