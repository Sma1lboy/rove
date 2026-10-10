package run.rove.mobile.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

private data class PluginSwitch(val id: String, val enabled: Boolean)

/** iOS `PluginsView`: installed plugins (`plugins.list`) with an on/off switch. Installing stays on the mac. */
@Composable fun PluginsSettings(model: AppModel, back: () -> Unit) {
    val fallback = stringResource(R.string.engines_failed)
    var state by remember { mutableStateOf<SettingsLoad<PluginsPayload>>(SettingsLoad.Loading) }
    var reloadError by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<PluginSwitch?>(null) }

    suspend fun load() {
        engineSettingsCall(fallback) { model.repository.pluginList() }
            .onSuccess { state = SettingsLoad.Loaded(it); reloadError = null }
            .onFailure { if (state.value == null) state = SettingsLoad.Failed(it.message.orEmpty()) else reloadError = it.message }
    }
    LaunchedEffect(Unit) { load() }

    SettingsPage(stringResource(R.string.plugins_title), back, refresh = { load() }) {
        when (val s = state) {
            SettingsLoad.Loading -> BrailleSpinner(14)
            is SettingsLoad.Failed -> ErrorLine(s.message)
            is SettingsLoad.Loaded -> {
                reloadError?.let { ErrorLine(it) }
                if (s.value.plugins.isEmpty()) EmptyState(stringResource(R.string.plugins_empty_title), stringResource(R.string.plugins_empty_detail))
                else EngineSettingsGroup {
                    s.value.plugins.forEachIndexed { index, plugin ->
                        if (index > 0) SettingsDivider()
                        PluginRow(plugin) { pending = PluginSwitch(plugin.id, !plugin.enabled) }
                    }
                }
                Hint(stringResource(R.string.plugins_hint_install))
            }
        }
    }

    pending?.let { change ->
        val label = stringResource(if (change.enabled) R.string.engines_switch_on else R.string.engines_switch_off)
        SettingsConfirmSheet(
            title = stringResource(if (change.enabled) R.string.plugins_confirm_on else R.string.plugins_confirm_off, change.id),
            kicker = stringResource(R.string.plugins_kicker),
            prose = stringResource(if (change.enabled) R.string.plugins_prose_on else R.string.plugins_prose_off, change.id),
            label = label, onDismiss = { pending = null },
            run = { model.repository.setPluginEnabled(change.id, change.enabled); load() }, failed = { load() })
    }
}

@Composable private fun PluginRow(plugin: PluginInfo, toggle: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(plugin.id, color = if (plugin.enabled) Rove.c.ink else Rove.c.muted, style = Rove.mono(14, FontWeight.Medium), maxLines = 2)
            Text(tagLine(plugin), style = Rove.mono(11))
            plugin.lastRun?.let { Text(lastRunText(it), color = Rove.c.muted, style = Rove.mono(12)) }
            declaresText(plugin.declares)?.let { Text(it, color = Rove.c.muted, style = Rove.mono(12)) }
        }
        TileLabel(stringResource(if (plugin.enabled) R.string.engines_switch_off else R.string.engines_switch_on),
            size = 12, onClick = toggle)
    }
}

/** `v1.2.0  on  linked  update available`: one wrapping line, each word in its own tone. */
@Composable private fun tagLine(plugin: PluginInfo): androidx.compose.ui.text.AnnotatedString {
    val c = Rove.c
    val version = "v${plugin.version}"
    val state = stringResource(if (plugin.enabled) R.string.engines_on else R.string.engines_tag_off)
    val linked = stringResource(R.string.plugins_linked)
    val update = stringResource(R.string.plugins_update)
    val platform = stringResource(R.string.plugins_platform)
    return buildAnnotatedString {
        fun tag(text: String, color: androidx.compose.ui.graphics.Color) = withStyle(SpanStyle(color = color)) { append("$text  ") }
        if (plugin.version.isNotEmpty()) tag(version, c.muted)
        tag(state, if (plugin.enabled) c.success else c.muted)
        if (plugin.linked) tag(linked, c.muted)
        if (plugin.updateAvailable) tag(update, c.accent)
        if (!plugin.platformOk) tag(platform, c.warning)
    }
}

@Composable private fun lastRunText(run: PluginLastRun): String {
    val result = stringResource(when {
        run.running -> R.string.plugins_running
        run.ok -> R.string.plugins_ok
        else -> R.string.plugins_run_failed
    })
    val age = SettingsFormat.age(run.at, System.currentTimeMillis())
    return if (age.isEmpty()) stringResource(R.string.plugins_last_run, run.label, result)
    else stringResource(R.string.plugins_last_run_ago, run.label, result, age)
}

@Composable private fun declaresText(d: PluginDeclares?): String? {
    d ?: return null
    val parts = listOfNotNull(
        if (d.actions > 0) pluralStringResource(R.plurals.plugins_actions, d.actions, d.actions) else null,
        if (d.events > 0) pluralStringResource(R.plurals.plugins_events, d.events, d.events) else null,
        if (d.panes > 0) pluralStringResource(R.plurals.plugins_panes, d.panes, d.panes) else null,
        if (d.engines > 0) pluralStringResource(R.plurals.plugins_engines, d.engines, d.engines) else null,
    )
    return if (parts.isEmpty()) stringResource(R.string.plugins_declares_nothing)
    else stringResource(R.string.plugins_declares, parts.joinToString(" · "))
}
