package run.rove.mobile.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.domain.DaemonInfo
import run.rove.mobile.domain.UsageTone

// Shared pieces of the Settings screens (iOS `SettingsParts.swift`): the pushed-page chrome, hairline-divided groups,
// mono tags, the destructive confirm sheet, and the stale-daemon notice.

/** Pushed screen: header with back, scrolling body, optional pull-to-refresh. Solid paper. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun SettingsPage(title: String, back: () -> Unit, refresh: (suspend () -> Unit)? = null,
                             content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(back) { Text(title, color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold), maxLines = 1) }
        val body: @Composable () -> Unit = {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp), content = content)
        }
        if (refresh == null) Box(Modifier.weight(1f)) { body() }
        else {
            val scope = rememberCoroutineScope()
            var busy by remember { mutableStateOf(false) }
            PullToRefreshBox(busy, { scope.launch { busy = true; try { refresh() } finally { busy = false } } }, Modifier.weight(1f)) { body() }
        }
    }
}

@Composable fun SettingsDivider() { Box(Modifier.fillMaxWidth().height(1.dp).background(Rove.c.line)) }

/** Mono tag in a tone. */
@Composable fun SettingsTag(text: String, tint: Color = Rove.c.muted, bold: Boolean = false) {
    Text(text, color = tint, maxLines = 1, softWrap = false, style = Rove.mono(11, if (bold) FontWeight.Bold else FontWeight.Medium))
}

/** Mono key on the left, value on the right: the pairing-screen info row. */
@Composable fun SettingsInfoRow(key: String, value: String, tint: Color = Rove.c.ink) {
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(key, color = Rove.c.muted, style = Rove.mono(13))
        SelectionContainer(Modifier.weight(1f)) {
            Text(value, Modifier.fillMaxWidth(), color = tint, style = Rove.mono(13), textAlign = TextAlign.End)
        }
    }
}

@Composable fun usageColor(tone: UsageTone): Color = when (tone) {
    UsageTone.Ok -> Rove.c.success
    UsageTone.Warn -> Rove.c.warning
    UsageTone.Crit -> Rove.c.error
}

/** `0.1.0 (1)`: the installed app's version name and code. */
@Composable fun rememberAppVersion(): String {
    val context = LocalContext.current
    return remember {
        runCatching {
            @Suppress("DEPRECATION") val info = context.packageManager.getPackageInfo(context.packageName, 0)
            @Suppress("DEPRECATION") "${info.versionName} (${info.versionCode})"
        }.getOrDefault("? (?)")
    }
}

/** A mono command the user pastes on the Mac: tap copies it. */
@Composable fun SettingsCopyCommand(command: String) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).tile(Rove.c.inset).pressable {
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(null, command))
        copied = true
    }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(command, Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(13, FontWeight.Medium))
        Text(stringResource(if (copied) R.string.settings_copied else R.string.settings_copy), color = Rove.c.muted, style = Rove.mono(12))
    }
}

/** `daemon out of date`, shown only when `daemon.info` says stale. */
@Composable fun StaleDaemonNotice(info: DaemonInfo) {
    FormSection(stringResource(R.string.settings_daemon)) {
        Column(Modifier.fillMaxWidth().tile(Rove.c.warning.copy(alpha = 0.10f), border = Rove.c.warning).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.settings_daemon_stale), color = Rove.c.warning, style = Rove.mono(14, FontWeight.Bold))
            Text(stringResource(R.string.settings_daemon_stale_body, info.daemonVersion ?: "?", info.bridgeVersion ?: "?"),
                color = Rove.c.ink, style = Rove.face(15))
            SettingsCopyCommand("rove daemon restart")
        }
    }
}

/**
 * The second confirm every destructive bridge op needs: says what changes, then a destructive `PrimaryBar`. `run`
 * throws the bridge's refusal, which lands here as an `ErrorLine`; `failed` lets the caller reload.
 */
@Composable fun SettingsConfirmSheet(title: String, kicker: String, prose: String, label: String, onDismiss: () -> Unit,
                                     run: suspend () -> Unit, failed: (suspend () -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    SheetScaffold(title, onDismiss, kicker, error, primary = {
        PrimaryBar(label, destructive = true, busy = busy) {
            scope.launch {
                busy = true
                try {
                    run()
                    onDismiss()
                } catch (e: TimeoutCancellationException) {
                    error = e.message
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    error = e.message ?: e.toString()
                    failed?.invoke()
                } finally { busy = false }
            }
        }
    }) { Text(prose, color = Rove.c.ink, style = Rove.face(16)) }
}
