package run.rove.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

/** iOS `EnginesView`: the engines registry (`engines.settings`); tap a row for its actions. */
@Composable fun EnginesSettings(model: AppModel, back: () -> Unit) {
    val fallback = stringResource(R.string.engines_failed)
    var state by remember { mutableStateOf<SettingsLoad<EnginesSettingsPayload>>(SettingsLoad.Loading) }
    var reloadError by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        engineSettingsCall(fallback) { model.repository.engineSettings() }
            .onSuccess { state = SettingsLoad.Loaded(it); reloadError = null }
            .onFailure { if (state.value == null) state = SettingsLoad.Failed(it.message.orEmpty()) else reloadError = it.message }
    }
    LaunchedEffect(Unit) { load() }

    SettingsPage(stringResource(R.string.engines_title), back, refresh = { load() }) {
        when (val s = state) {
            SettingsLoad.Loading -> BrailleSpinner(14)
            is SettingsLoad.Failed -> ErrorLine(s.message)
            is SettingsLoad.Loaded -> {
                reloadError?.let { ErrorLine(it) }
                if (s.value.engines.isEmpty()) EmptyState(stringResource(R.string.engines_empty_title), stringResource(R.string.engines_empty_detail))
                else EngineSettingsGroup {
                    s.value.engines.forEachIndexed { index, engine ->
                        if (index > 0) SettingsDivider()
                        EngineRow(engine) { selected = engine.id }
                    }
                }
                Hint(stringResource(R.string.engines_hint_launch))
            }
        }
    }

    selected?.let { id ->
        EngineDetail(model, id, state.value?.engines.orEmpty(), reload = { load() }, onDismiss = { selected = null })
    }
}

/** Hairline-divided rows on one tile; the ripple of the first and last row stays inside the corners. */
@Composable internal fun EngineSettingsGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().tile().clip(RoundedCornerShape(Rove.radius)), content = content)
}

@Composable private fun EngineRow(engine: EngineSetting, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).semantics(mergeDescendants = true) {}
        .padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(engine.displayName, Modifier.weight(1f, fill = false), color = if (engine.enabled) Rove.c.ink else Rove.c.muted,
                style = Rove.face(16, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (engine.isDefault) SettingsTag(stringResource(R.string.engines_tag_default), Rove.c.accent, bold = true)
            if (!engine.enabled) SettingsTag(stringResource(R.string.engines_tag_off))
            if (engine.custom) SettingsTag(stringResource(R.string.engines_tag_custom))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (engine.binaryFound == false) Text(stringResource(R.string.engines_not_found), color = Rove.c.warning, style = Rove.mono(12))
            else Text(engine.binaryPath ?: engine.binary ?: "—", Modifier.weight(1f, fill = false), color = Rove.c.ink,
                style = Rove.mono(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("·", color = Rove.c.muted, style = Rove.mono(12))
            Text(loginText(engine), color = Rove.c.ink, style = Rove.mono(12), maxLines = 1)
        }
        Text(reportText(engine), color = Rove.c.muted, style = Rove.mono(12))
        engine.configIssue?.takeIf { it.isNotEmpty() }?.let { ErrorLine(it) }
    }
}

@Composable private fun loginText(e: EngineSetting) = stringResource(when (e.login) {
    "yes" -> R.string.engines_login_yes
    "no" -> R.string.engines_login_no
    else -> R.string.engines_login_unknown
})

/** How the engine reports to Rove: hooks, completion markers, screen rules. */
@Composable private fun reportText(e: EngineSetting): String {
    val hooks = stringResource(when (e.hooks) {
        "installed" -> R.string.engines_hooks_installed
        "outdated" -> R.string.engines_hooks_outdated
        "not-installed" -> R.string.engines_hooks_missing
        else -> R.string.engines_hooks_none
    })
    val markers = stringResource(if (e.markers) R.string.engines_markers else R.string.engines_no_markers)
    val screen = stringResource(if (e.screen) R.string.engines_screen_rules else R.string.engines_no_screen_rules)
    return listOf(hooks, markers, screen).joinToString(" · ")
}

/** One engine write; every one is destructive in the bridge, so each goes through a confirm sheet. */
private sealed interface EngineAction {
    data class SetEnabled(val on: Boolean) : EngineAction
    data object SetDefault : EngineAction
    data class Rename(val name: String) : EngineAction
    data object Reset : EngineAction
}

private suspend fun EngineAction.run(repository: RoveRepository, id: String) {
    when (this) {
        is EngineAction.SetEnabled -> repository.setEngineEnabled(id, on)
        EngineAction.SetDefault -> repository.setEngineDefault(id)
        is EngineAction.Rename -> repository.renameEngine(id, name)
        EngineAction.Reset -> repository.resetEngine(id)
    }
}

@Composable private fun EngineAction.label(e: EngineSetting) = stringResource(when (this) {
    is EngineAction.SetEnabled -> if (on) R.string.engines_switch_on else R.string.engines_switch_off
    EngineAction.SetDefault -> R.string.engines_make_default
    is EngineAction.Rename -> R.string.engines_rename
    EngineAction.Reset -> if (e.custom) R.string.engines_remove else R.string.engines_reset
})

/** The prose says exactly what the write changes. */
@Composable private fun EngineAction.prose(e: EngineSetting): String = when (this) {
    is EngineAction.SetEnabled -> stringResource(when {
        on -> R.string.engines_prose_on
        e.isDefault -> R.string.engines_prose_off_default
        else -> R.string.engines_prose_off
    }, e.displayName)
    EngineAction.SetDefault -> stringResource(if (e.enabled) R.string.engines_prose_default else R.string.engines_prose_default_off, e.displayName)
    is EngineAction.Rename ->
        if (name.isEmpty()) stringResource(R.string.engines_prose_rename_clear, e.id) else stringResource(R.string.engines_prose_rename, e.id, name)
    EngineAction.Reset -> stringResource(if (e.custom) R.string.engines_prose_remove else R.string.engines_prose_reset, e.displayName)
}

/** iOS `EngineDetail`: an engine's facts and its four actions. Looks the engine up by id so a reload refreshes the sheet. */
@Composable private fun EngineDetail(model: AppModel, engineId: String, engines: List<EngineSetting>,
                                     reload: suspend () -> Unit, onDismiss: () -> Unit) {
    val engine = engines.firstOrNull { it.id == engineId }
    var pending by remember { mutableStateOf<EngineAction?>(null) }
    var name by remember(engineId) { mutableStateOf(engine?.displayName.orEmpty()) }
    LaunchedEffect(engine == null) { if (engine == null) onDismiss() }

    SheetScaffold(title = engine?.displayName ?: engineId, onDismiss = onDismiss, kicker = stringResource(R.string.engines_kicker)) {
        if (engine == null) EmptyState(stringResource(R.string.engines_gone_title), stringResource(R.string.engines_gone_detail))
        else {
            EngineFacts(engine)
            EngineActions(engine, engines, name, { name = it }) { pending = it }
        }
    }

    val action = pending
    if (action != null && engine != null) {
        val label = action.label(engine)
        SettingsConfirmSheet(title = stringResource(R.string.engines_confirm_title, label), kicker = stringResource(R.string.engines_kicker),
            prose = action.prose(engine), label = label, onDismiss = { pending = null },
            run = { action.run(model.repository, engine.id); reload() }, failed = { reload() })
    }
}

@Composable private fun EngineFacts(e: EngineSetting) {
    val on = stringResource(if (e.enabled) R.string.engines_on else R.string.engines_tag_off)
    val status = listOfNotNull(on, if (e.isDefault) stringResource(R.string.engines_tag_default) else null).joinToString(" · ")
    EngineSettingsGroup {
        SettingsInfoRow("id", e.id)
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.engines_fact_kind), stringResource(when {
            e.custom -> R.string.engines_tag_custom
            e.builtin -> R.string.engines_kind_builtin
            else -> R.string.engines_kind_detected
        }))
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.engines_fact_status), status)
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.engines_fact_binary),
            if (e.binaryFound == false) stringResource(R.string.engines_not_found) else e.binaryPath ?: e.binary ?: "—",
            tint = if (e.binaryFound == false) Rove.c.warning else Rove.c.ink)
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.engines_fact_account), loginText(e))
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.engines_fact_reports), reportText(e))
    }
}

@Composable private fun ColumnScope.EngineActions(e: EngineSetting, all: List<EngineSetting>, name: String,
                                                  onName: (String) -> Unit, choose: (EngineAction) -> Unit) {
    e.configIssue?.takeIf { it.isNotEmpty() }?.let { ErrorLine(it) }
    val canDisable = EngineLogic.canDisable(e, all)
    FormSection(stringResource(R.string.engines_actions)) {
        EngineSettingsGroup {
            if (e.enabled) ActionRow(stringResource(R.string.engines_switch_off), tint = if (canDisable) Rove.c.ink else Rove.c.muted) {
                if (canDisable) choose(EngineAction.SetEnabled(false))
            } else ActionRow(stringResource(R.string.engines_switch_on)) { choose(EngineAction.SetEnabled(true)) }
            if (e.canBeDefault && !e.isDefault) {
                SettingsDivider()
                ActionRow(stringResource(R.string.engines_make_default)) { choose(EngineAction.SetDefault) }
            }
            SettingsDivider()
            ActionRow(stringResource(if (e.custom) R.string.engines_remove else R.string.engines_reset), tint = Rove.c.error) { choose(EngineAction.Reset) }
        }
        if (e.enabled && !canDisable) Hint(stringResource(R.string.engines_hint_last_enabled))
        if (!e.canBeDefault) Hint(stringResource(R.string.engines_hint_default_only))
    }
    FormSection(stringResource(R.string.engines_display_name)) {
        FieldBox(name, onName, stringResource(R.string.engines_name_placeholder))
        val trimmed = name.trim()
        Box(Modifier.fillMaxWidth().tile()) {
            ActionRow(stringResource(if (trimmed.isEmpty()) R.string.engines_clear_name else R.string.engines_rename), tint = Rove.c.accent) {
                choose(EngineAction.Rename(trimmed))
            }
        }
        Hint(stringResource(R.string.engines_hint_blank_clears))
    }
}
