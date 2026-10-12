package run.rove.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

/** Local navigation inside Settings; `Route` is closed, so these sub-screens stack here (iOS `SettingsRoute`). */
private enum class SettingsRoute { Bridge, Usage, Engines, Plugins, Notifications, Activity, Feedback, About }

/** Settings home plus its pushed pages. System back leaves a page first, then Settings itself (via the parent). */
@Composable fun SettingsScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    var route by rememberSaveable { mutableStateOf<SettingsRoute?>(null) }
    val home = { route = null }
    BackHandler(route != null, home)
    when (route) {
        null -> SettingsHome(model, back, open) { route = it }
        SettingsRoute.Bridge -> BridgeSettings(model, home)
        SettingsRoute.Usage -> UsageSettings(model, home)
        SettingsRoute.Engines -> EnginesSettings(model, home)
        SettingsRoute.Plugins -> PluginsSettings(model, home)
        SettingsRoute.Notifications -> NotificationsSettings(home)
        SettingsRoute.Activity -> ActivitySettings(model, home)
        SettingsRoute.Feedback -> FeedbackSettings(model, home)
        SettingsRoute.About -> AboutSettings(model, home)
    }
}

/** One home row: mono title, mono muted detail on the right, chevron. */
@Composable private fun SettingsRow(title: String, detail: String = "", detailTint: Color = Rove.c.muted, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).pressable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(14, FontWeight.Medium))
        if (detail.isNotEmpty()) Text(detail, color = detailTint, style = Rove.mono(12), maxLines = 1)
        Text("›", color = Rove.c.muted, style = Rove.mono(14))
    }
}

/** The four home summaries; each one that fails stays null and its row reads `—`. */
private class HomeSummary(val usage: UsagePayload? = null, val daemon: DaemonInfo? = null, val enginesOn: Pair<Int, Int>? = null,
                          val pluginsOn: Int? = null)

@Composable private fun SettingsHome(model: AppModel, back: () -> Unit, open: (Route) -> Unit, push: (SettingsRoute) -> Unit) {
    val context = LocalContext.current
    val state by model.bridge.state.collectAsStateWithLifecycle()
    var summary by remember { mutableStateOf(HomeSummary()) }
    val notificationsOn = remember { NotificationPrefs.enabled(context) }
    val dash = "—"

    suspend fun load() {
        summary = coroutineScope {
            val repo = model.repository
            val usage = async { settingsCatching { repo.usageGet() }.getOrNull() }
            val daemon = async { settingsCatching { repo.daemonInfo() }.getOrNull() }
            val engines = async { settingsCatching { repo.engineSettings() }.getOrNull() }
            val plugins = async { settingsCatching { repo.pluginList() }.getOrNull() }
            HomeSummary(usage.await(), daemon.await(), engines.await()?.let { e -> e.engines.count { it.enabled } to e.engines.size },
                plugins.await()?.let { p -> p.plugins.count { it.enabled } })
        }
    }
    LaunchedEffect(Unit) { load() }

    val tightest = summary.usage?.usage?.let(UsageLogic::tightest)
    val usageDetail = tightest?.let { "${it.first} ${it.second}%" } ?: dash
    val usageTint = tightest?.let { usageColor(UsageTone.of(it.second)) } ?: Rove.c.muted
    val enginesDetail = summary.enginesOn?.let { stringResource(R.string.settings_engines_on, it.first, it.second) } ?: dash
    val pluginsDetail = summary.pluginsOn?.let { stringResource(R.string.settings_plugins_on, it) } ?: dash

    SettingsPage(stringResource(R.string.settings_title), back, refresh = { load() }) {
        summary.daemon?.takeIf { it.stale }?.let { StaleDaemonNotice(it) }
        Column(Modifier.fillMaxWidth().tile()) {
            SettingsRow(stringResource(R.string.settings_bridge), settingsConnectionLabel(state).lowercase()) { push(SettingsRoute.Bridge) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_usage), usageDetail, usageTint) { push(SettingsRoute.Usage) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_engines), enginesDetail) { push(SettingsRoute.Engines) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_plugins), pluginsDetail) { push(SettingsRoute.Plugins) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_notifications),
                stringResource(if (notificationsOn) R.string.settings_on else R.string.settings_off)) { push(SettingsRoute.Notifications) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_worktrees)) { open(Route.Worktrees) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_activity)) { push(SettingsRoute.Activity) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_feedback)) { push(SettingsRoute.Feedback) }
            SettingsDivider()
            SettingsRow(stringResource(R.string.settings_about), rememberAppVersion()) { push(SettingsRoute.About) }
        }
    }
}

/** The connection state as the list header prints it. */
@Composable fun settingsConnectionLabel(state: Connection): String = when (state) {
    is Connection.Connected -> stringResource(R.string.settings_state_connected)
    Connection.Connecting -> stringResource(R.string.settings_state_connecting)
    is Connection.Retrying -> stringResource(R.string.settings_state_reconnecting, state.attempt)
    Connection.Disconnected -> stringResource(R.string.settings_state_offline)
    is Connection.Failed -> stringResource(R.string.settings_state_failed)
}
