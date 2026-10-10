package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

/** Quota meters per engine vendor (`usage.get`), the TUI's usage bars. */
@Composable fun UsageSettings(model: AppModel, back: () -> Unit) {
    var state by remember { mutableStateOf<SettingsLoad<UsagePayload>>(SettingsLoad.Loading) }
    suspend fun load() { state = settingsCatching { model.repository.usageGet() }.toLoad() }
    LaunchedEffect(Unit) { load() }
    SettingsPage(stringResource(R.string.settings_usage), back, refresh = { load() }) {
        when (val s = state) {
            SettingsLoad.Loading -> BrailleSpinner(14)
            is SettingsLoad.Failed -> ErrorLine(s.message)
            is SettingsLoad.Loaded -> UsageContent(s.value)
        }
    }
}

@Composable private fun UsageContent(payload: UsagePayload) {
    val vendors = payload.usage
    val now = System.currentTimeMillis()
    if (vendors == null) EmptyState(stringResource(R.string.settings_usage_none_yet), stringResource(R.string.settings_usage_none_yet_detail))
    else if (vendors.isEmpty()) EmptyState(stringResource(R.string.settings_usage_no_quota), stringResource(R.string.settings_usage_no_quota_detail))
    else vendors.forEach { vendor ->
        val age = SettingsFormat.age(vendor.capturedAt, now)
        FormSection(vendor.displayName.lowercase(), trailing = age.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.settings_ago, it) }) {
            Column(Modifier.fillMaxWidth().tile()) {
                vendor.windows.forEachIndexed { index, window ->
                    if (index > 0) SettingsDivider()
                    WindowRow(window, now)
                }
            }
        }
    }
}

@Composable private fun WindowRow(window: UsageWindow, now: Long) {
    val tone = usageColor(UsageTone.of(window.percent))
    Row(Modifier.fillMaxWidth().heightIn(min = 46.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(window.display, Modifier.width(34.dp), color = Rove.c.ink, style = Rove.mono(13, FontWeight.Medium), maxLines = 1)
        Meter(window.percent, tone, Modifier.weight(1f))
        Text("${window.percent}%", Modifier.width(44.dp), color = tone, style = Rove.mono(13, FontWeight.SemiBold),
            textAlign = TextAlign.End, maxLines = 1)
        // A fixed column even when empty, so every meter in the group has the same length.
        Text(UsageLogic.resetText(window.resetsAt, now), Modifier.width(92.dp), color = Rove.c.muted, style = Rove.mono(11),
            textAlign = TextAlign.End, maxLines = 1)
    }
}

/** Inset track, fill capped at 100% in the tone color. */
@Composable private fun Meter(percent: Int, tint: Color, modifier: Modifier = Modifier) {
    Box(modifier.height(6.dp).clip(RoundedCornerShape(3.dp)).background(Rove.c.inset)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(percent.coerceIn(0, 100) / 100f).background(tint))
    }
}
