package run.rove.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

@Composable private fun toneColor(tone: StatusTone): Color = when (tone) {
    StatusTone.Success -> Rove.c.success
    StatusTone.Muted -> Rove.c.muted
    StatusTone.Warning -> Rove.c.warning
    StatusTone.Error -> Rove.c.error
}

/** What agents did in a repo lately: `repo.digest` counts and `turns.list` telemetry. */
@Composable fun ActivitySettings(model: AppModel, back: () -> Unit) {
    var repos by remember { mutableStateOf<SettingsLoad<List<String>>>(SettingsLoad.Loading) }
    var repo by rememberSaveable { mutableStateOf("") }
    var days by rememberSaveable { mutableStateOf(7) }
    var digest by remember { mutableStateOf<SettingsLoad<DigestResult>>(SettingsLoad.Loading) }
    var turns by remember { mutableStateOf<SettingsLoad<TurnsResult>>(SettingsLoad.Loading) }

    suspend fun loadRepos() {
        repos = settingsCatching { model.repository.repos() }.toLoad()
        repos.value?.let { list -> if (repo !in list) repo = list.firstOrNull().orEmpty() }
    }
    suspend fun reload() {
        if (repos.value == null) loadRepos()
        if (repo.isEmpty()) return
        val (r, d) = repo to days
        coroutineScope {
            val a = async { settingsCatching { model.repository.repoDigest(r, d) }.toLoad() }
            val b = async { settingsCatching { model.repository.turnsList(r, d) }.toLoad() }
            val (dg, tr) = a.await() to b.await()
            // A slower answer for a repo or window the user already left must not overwrite the current one.
            if (r == repo && d == days) { digest = dg; turns = tr }
        }
    }
    LaunchedEffect(repo, days) {
        digest = SettingsLoad.Loading
        turns = SettingsLoad.Loading
        reload()
    }

    SettingsPage(stringResource(R.string.settings_activity), back, refresh = { reload() }) {
        when (val r = repos) {
            SettingsLoad.Loading -> BrailleSpinner(14)
            is SettingsLoad.Failed -> ErrorLine(r.message)
            is SettingsLoad.Loaded -> if (r.value.isEmpty()) {
                EmptyState(stringResource(R.string.settings_activity_no_repos), stringResource(R.string.settings_activity_no_repos_detail))
            } else {
                FormSection(stringResource(R.string.settings_repo)) {
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        r.value.forEach { PickerTile(it.trimEnd('/').substringAfterLast('/'), it == repo) { repo = it } }
                    }
                }
                FormSection(stringResource(R.string.settings_window)) {
                    ChoiceTiles(listOf(7, 14, 30), days, { "${it}d" }) { days = it }
                }
                DigestSection(digest)
                TurnsSection(turns)
            }
        }
    }
}

@Composable private fun PickerTile(label: String, on: Boolean, onClick: () -> Unit) {
    Box(Modifier.heightIn(min = 40.dp).selectableTile(on).pressable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(label, Modifier.padding(horizontal = 12.dp), color = if (on) Rove.c.accent else Rove.c.ink, maxLines = 1,
            style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal))
    }
}

@Composable private fun DigestSection(digest: SettingsLoad<DigestResult>) {
    FormSection(stringResource(R.string.settings_digest)) {
        when (digest) {
            SettingsLoad.Loading -> BrailleSpinner(14)
            is SettingsLoad.Failed -> ErrorLine(digest.message)
            is SettingsLoad.Loaded -> Column(Modifier.fillMaxWidth().tile()) {
                val d = digest.value
                SettingsInfoRow(stringResource(R.string.settings_tasks_touched), "${d.tasks.total}")
                SettingsDivider()
                SettingsInfoRow(stringResource(R.string.settings_routine_runs), "${d.routines.runs}")
                d.routines.byStatus.keys.sorted().forEach { status ->
                    SettingsDivider()
                    SettingsInfoRow(status, "${d.routines.byStatus[status]}", toneColor(SettingsFormat.statusTone(status)))
                }
            }
        }
    }
}

@Composable private fun TurnsSection(turns: SettingsLoad<TurnsResult>) {
    when (turns) {
        SettingsLoad.Loading -> FormSection(stringResource(R.string.settings_turns)) { BrailleSpinner(14) }
        is SettingsLoad.Failed -> FormSection(stringResource(R.string.settings_turns)) { ErrorLine(turns.message) }
        is SettingsLoad.Loaded -> {
            val result = turns.value
            if (result.totals.turns == 0 && result.turns.isEmpty()) FormSection(stringResource(R.string.settings_turns)) {
                EmptyState(stringResource(R.string.settings_turns_none), stringResource(R.string.settings_turns_none_detail))
            } else {
                FormSection(stringResource(R.string.settings_turns)) { Totals(result.totals) }
                FormSection(stringResource(R.string.settings_latest)) { Latest(result.turns) }
            }
        }
    }
}

@Composable private fun Totals(t: TurnTotals) {
    Column(Modifier.fillMaxWidth().tile()) {
        SettingsInfoRow(stringResource(R.string.settings_turns), "${t.turns}")
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.settings_input), SettingsFormat.compact(t.inputTokens))
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.settings_output), SettingsFormat.compact(t.outputTokens))
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.settings_cache), SettingsFormat.compact(t.cacheReadTokens + t.cacheCreationTokens))
        SettingsDivider()
        SettingsInfoRow(stringResource(R.string.settings_time), SettingsFormat.duration(t.durationMs))
        t.byModel.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).forEach {
            SettingsDivider()
            SettingsInfoRow(it.key, "${it.value}")
        }
    }
}

@Composable private fun Latest(all: List<TurnRecord>) {
    val rows = all.sortedByDescending { it.endedAt }.take(10)
    val now = System.currentTimeMillis()
    Column(Modifier.fillMaxWidth().tile()) {
        rows.forEachIndexed { index, turn ->
            if (index > 0) SettingsDivider()
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(turn.model ?: stringResource(R.string.settings_unknown_model), color = Rove.c.ink,
                        style = Rove.mono(13, FontWeight.Medium), maxLines = 1)
                    turn.vendor?.let { Text(it, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1) }
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(SettingsFormat.duration(turn.durationMs), color = Rove.c.ink, style = Rove.mono(13))
                    val age = SettingsFormat.age(turn.endedAt, now)
                    if (age.isNotEmpty()) Text(stringResource(R.string.settings_ago, age), color = Rove.c.muted, style = Rove.mono(11))
                }
            }
        }
    }
}
