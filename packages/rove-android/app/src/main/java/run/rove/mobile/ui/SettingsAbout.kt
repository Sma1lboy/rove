package run.rove.mobile.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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

/** `docs/PRIVACY.md`, copied in at build time: the policy Play Console links to, readable without a bridge. */
private const val PrivacyAsset = "docs/PRIVACY.md"

/** Versions, the host, the privacy policy, and the licenses of what the app ships. */
@Composable fun AboutSettings(model: AppModel, back: () -> Unit) {
    val context = LocalContext.current
    var license by rememberSaveable { mutableStateOf<String?>(null) }
    BackHandler(license != null) { license = null }
    license?.let { asset ->
        if (asset == PrivacyAsset) {
            LicensePage(stringResource(R.string.settings_privacy), asset, PolicyText::plain) { license = null }
        } else {
            val entry = Licenses.first { it.asset == asset }
            LicensePage(stringResource(entry.name), asset) { license = null }
        }
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
        UpdateSection(model) { load() }
        Hint(stringResource(R.string.settings_about_language))
        Hint(stringResource(R.string.settings_about_mac_side))
        Column(Modifier.fillMaxWidth().tile()) {
            DocumentRow(stringResource(R.string.settings_privacy)) { license = PrivacyAsset }
        }
        if (shipped.isNotEmpty()) FormSection(stringResource(R.string.settings_licenses)) {
            Column(Modifier.fillMaxWidth().tile()) {
                shipped.forEachIndexed { index, entry ->
                    if (index > 0) SettingsDivider()
                    DocumentRow(stringResource(entry.name)) { license = entry.asset }
                }
            }
        }
    }
}

/** The web's Update page: the Mac asks the registry, Update now runs `rove update` there, then Restart Rove moves onto it. */
@Composable private fun UpdateSection(model: AppModel, restarted: suspend () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val updates = remember { UpdateSettingsState() }
    val check by updates.check.collectAsState()
    // A bridge without `prefs.get` leaves the rows out and checks its own channel.
    val prefs by updates.prefs.collectAsState()
    LaunchedEffect(Unit) { updates.loadPrefs(settingsCatching { model.repository.updatePrefs() }.getOrNull()) }
    val channelName = mapOf("latest" to stringResource(R.string.settings_channel_latest), "next" to stringResource(R.string.settings_channel_next),
        "nightly" to stringResource(R.string.settings_channel_nightly))
    val on = stringResource(R.string.settings_on)
    val off = stringResource(R.string.settings_off)
    val locale = LocalConfiguration.current.locales[0].language.takeIf { it == "zh" } ?: "en"
    val result = (check as? SettingsLoad.Loaded)?.value
    val latest = result?.info
    var run by remember { mutableStateOf<UpdateRun?>(null) }
    var polling by remember { mutableStateOf(true) }
    var confirming by remember { mutableStateOf(false) }
    var restarting by remember { mutableStateOf(false) }
    var restartError by remember { mutableStateOf<String?>(null) }
    // Follows a run another client started too; stops once the installer exits or the bridge cannot say.
    LaunchedEffect(polling) {
        while (polling) {
            val status = settingsCatching { model.repository.updateStatus() }
            run = status.getOrNull() ?: run
            if (status.getOrNull()?.running != true) polling = false else delay(1_000)
        }
    }
    // The restarted bridge is a new process with no run to report: back on the new build, start over.
    val connection by model.bridge.state.collectAsState()
    LaunchedEffect(connection) {
        if (restarting && connection is Connection.Connected) { restarting = false; run = null; restarted() }
    }
    // Installed but not yet running: the old bridge still reports the update, and installing twice does nothing.
    val installed = run?.code == 0
    prefs?.let { current ->
        FormSection(stringResource(R.string.settings_channel)) {
            ChoiceTiles(channelName.keys.toList(), current.updateChannel, { channelName.getValue(it) }) { picked ->
                model.action { updates.saveChannel(picked) { model.repository.setUpdateChannel(it) } }
            }
            Hint(stringResource(R.string.settings_channel_hint))
        }
        FormSection(stringResource(R.string.settings_update_notify)) {
            ChoiceTiles(listOf(true, false), current.updateNotify, { if (it) on else off }) { picked ->
                model.action { updates.saveNotify(picked) { model.repository.setUpdateNotify(it) } }
            }
            Hint(stringResource(R.string.settings_update_notify_hint))
        }
    }
    if (confirming) SettingsConfirmSheet(stringResource(R.string.settings_update_confirm_title), stringResource(R.string.settings_updates),
        stringResource(R.string.settings_update_confirm_body), stringResource(R.string.settings_update_now), { confirming = false }, run = {
            try { run = model.repository.startUpdate() }
            // Another client already started it: follow that run.
            catch (e: BridgeFailure) { if (e.code != "BUSY") throw e }
            polling = true
        })
    FormSection(stringResource(R.string.settings_updates)) {
        Column(Modifier.fillMaxWidth().tile()) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).pressable(enabled = check != SettingsLoad.Loading) {
                scope.launch { updates.checkForUpdate { channel ->
                    settingsCatching { model.repository.checkForUpdate(locale, channel) }.toLoad()
                } }
            }.padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(if (check == SettingsLoad.Loading) R.string.settings_update_checking else R.string.settings_update_check),
                    Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(14, FontWeight.Medium))
            }
        }
        (check as? SettingsLoad.Failed)?.let { ErrorLine(it.message) }
        when {
            result == null -> Unit
            result.upToDate -> Hint(stringResource(R.string.settings_update_current))
            latest == null -> Hint(stringResource(R.string.settings_update_unknown))
            else -> {
                Text(stringResource(R.string.settings_update_available, latest.latest), color = Rove.c.accent, style = Rove.mono(13, FontWeight.Medium))
                if (run?.running != true && !installed) {
                    Column(Modifier.fillMaxWidth().tile()) {
                        DocumentRow(stringResource(R.string.settings_update_now)) { confirming = true }
                    }
                }
                result.notes.firstOrNull()?.url?.let { url ->
                    Column(Modifier.fillMaxWidth().tile()) {
                        DocumentRow(stringResource(R.string.settings_update_open_release)) { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
                    }
                }
            }
        }
        run?.let { UpdateRunLines(it, latest?.latest.orEmpty(), restarting) }
        if (installed) {
            PrimaryBar(stringResource(R.string.settings_update_restart), busy = restarting) {
                restarting = true; restartError = null
                scope.launch {
                    // A refusal re-arms the button; the dropped socket is the restart itself.
                    try { model.repository.restartRove() }
                    catch (e: BridgeFailure) { if (e.code != "DISCONNECTED") { restarting = false; restartError = e.message } }
                    catch (e: CancellationException) { throw e }
                    catch (_: Exception) {}
                }
            }
        }
        restartError?.let { ErrorLine(it) }
    }
}

@Composable private fun UpdateRunLines(run: UpdateRun, latest: String, restarting: Boolean) {
    if (run.output.isNotBlank()) {
        SelectionContainer(Modifier.fillMaxWidth().tile().padding(10.dp)) {
            // The tail is where npm reports success or the error.
            Text(run.output.trimEnd().lines().takeLast(12).joinToString("\n"), color = Rove.c.muted, style = Rove.mono(11))
        }
    }
    val (line, tint) = when {
        run.running -> stringResource(R.string.settings_update_running, run.command) to Rove.c.muted
        run.code == 0 && restarting -> stringResource(R.string.settings_update_restarting) to Rove.c.muted
        run.code == 0 -> stringResource(R.string.settings_update_installed, latest) to Rove.c.success
        else -> stringResource(R.string.settings_update_failed, run.code ?: 1) to Rove.c.error
    }
    Text(line, Modifier.fillMaxWidth(), color = tint, style = Rove.mono(12))
}

@Composable private fun DocumentRow(label: String, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).pressable(onClick = open).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(14, FontWeight.Medium))
        Text("›", color = Rove.c.muted, style = Rove.mono(14))
    }
}

@Composable private fun LicensePage(title: String, asset: String, format: (String) -> String = { it }, back: () -> Unit) {
    val context = LocalContext.current
    val text = remember(asset) {
        runCatching { context.assets.open(asset).bufferedReader().use { format(it.readText()) } }.getOrDefault("")
    }
    SettingsPage(title, back) {
        SelectionContainer { Text(text.trim(), color = Rove.c.ink, style = Rove.mono(11)) }
    }
}
