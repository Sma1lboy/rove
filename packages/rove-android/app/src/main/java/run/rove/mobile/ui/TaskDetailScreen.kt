package run.rove.mobile.ui

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*
import java.util.Locale

// iOS Detail/TaskDetailView.swift: title block, meta strip, tab strip, then the terminal pane filling the rest.

@OptIn(ExperimentalLayoutApi::class)
@Composable fun TaskDetailScreen(model: AppModel, taskId: String, back: () -> Unit) {
    // With the keyboard up or in a short (landscape) window, the header strips give their rows to the terminal.
    val windowHeight = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.height.toDp() }
    val compact = WindowInsets.isImeVisible || windowHeight < 500.dp
    val connection by model.bridge.state.collectAsStateWithLifecycle()
    val connected = connection is Connection.Connected
    val taskSnapshot by model.tasks.collectAsStateWithLifecycle()
    val task = taskSnapshot.tasks.firstOrNull { it.id == taskId }
    var tabs by remember(taskId) { mutableStateOf<List<TabRow>?>(null) }
    var tabStates by remember(taskId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var diffStat by remember(taskId) { mutableStateOf<DiffStat?>(null) }
    var selected by remember(taskId) { mutableStateOf<String?>(null) }
    var fit by remember(taskId) { mutableStateOf(true) }
    var newTab by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var diff by remember(taskId) { mutableStateOf(false) }
    var action by remember { mutableStateOf<String?>(null) }
    var confirmation by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    val tabsError = stringResource(R.string.detail_tabs_error)
    LaunchedEffect(taskId, connection, revision) {
        if (!connected) return@LaunchedEffect
        try {
            val loaded = model.repository.tabs(taskId)
            tabs = loaded
            if (selected !in loaded.map { it.id }) selected = (loaded.firstOrNull { it.kind == "engine" } ?: loaded.firstOrNull())?.id
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { model.error.value = tabsError }
        // The strip's diff chip is best effort: a failure leaves it as a bare label.
        try {
            val files = model.repository.diffFiles(taskId).files
            diffStat = DiffStat(files.size, files.sumOf { it.added ?: 0 }, files.sumOf { it.deleted ?: 0 })
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) {}
    }
    // Per-tab activity does not always move the task's rolled-up row, so poll while visible.
    LaunchedEffect(taskId, connected) {
        while (connected) { tabStates = model.repository.tabStates(taskId); delay(4000) }
    }
    if (diff) DiffScreen(model, taskId, back = { diff = false })
    else Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        if (!compact) {
            var menu by remember { mutableStateOf(false) }
            val more = stringResource(R.string.detail_more)
            ScreenHeader(back, trailing = {
                Box {
                    Box(Modifier.size(40.dp, 36.dp).pressable { menu = true }.semantics { contentDescription = more }, contentAlignment = Alignment.Center) {
                        Text("···", color = Rove.c.ink, style = Rove.mono(18, FontWeight.Medium), maxLines = 1)
                    }
                    MoreMenu(menu, { menu = false }, connected,
                        onDelete = { action = "delete"; confirmation = 1 }, onRefresh = { revision++ })
                }
            }) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(task?.displayTitle ?: stringResource(R.string.detail_loading), color = Rove.c.ink,
                        style = Rove.face(16, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!task?.branch.isNullOrEmpty()) Text(task!!.branch, color = Rove.c.muted, style = Rove.mono(12),
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            MetaStrip(task, showMode = selected != null, fit = fit, onFit = { fit = it })
            TabStrip(tabs.orEmpty(), selected, tabStates, diffStat, connected, onSelect = { selected = it },
                onNewTab = { newTab = true }, onDiff = { diff = true }, onLand = { action = "land"; confirmation = 1 })
        }
        val current = tabs?.firstOrNull { it.id == selected }
        if (current != null) key(taskId, current.id) { TerminalView(model, taskId, current.id, current.engineName, fit) }
        else if (tabs != null) NoTabState(tabs.orEmpty().isEmpty()) { newTab = true }
    }
    if (newTab) CreateSheet(model, taskId, { newTab = false }, { newTab = false; selected = it; revision++ })
    if (action != null) ConfirmDialog(action!!, confirmation, busy, task, onDismiss = { if (!busy) action = null }) {
        if (confirmation == 1) confirmation = 2
        else if (!busy) {
            busy = true
            val delete = action == "delete"
            model.action {
                try {
                    if (delete) model.repository.delete(taskId) else model.repository.land(taskId)
                    action = null; model.refresh(); back()
                } finally { busy = false }
            }
        }
    }
}

private data class DiffStat(val files: Int, val added: Int, val deleted: Int)

@Composable private fun MoreMenu(open: Boolean, dismiss: () -> Unit, connected: Boolean, onDelete: () -> Unit, onRefresh: () -> Unit) {
    DropdownMenu(open, dismiss, containerColor = Rove.c.surface, shape = RoundedCornerShape(Rove.radius), tonalElevation = 0.dp,
        shadowElevation = 4.dp, border = BorderStroke(1.dp, Rove.c.line)) {
        DropdownMenuItem(enabled = connected, onClick = { dismiss(); onDelete() }, text = {
            Text(stringResource(R.string.detail_menu_delete), color = Rove.c.error, style = Rove.mono(14, FontWeight.Medium))
        })
        DropdownMenuItem(onClick = { dismiss(); onRefresh() }, text = {
            Text(stringResource(R.string.detail_menu_refresh), color = Rove.c.ink, style = Rove.mono(14, FontWeight.Medium))
        })
    }
}

/** Status tag · engine · live timer; the terminal mode toggle on the right. */
@Composable private fun MetaStrip(task: TaskRow?, showMode: Boolean, fit: Boolean, onFit: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (task != null) {
            StatusTag(task.group)
            task.engine?.let { Dot(); Text(it.name.lowercase(), color = Rove.c.muted, style = Rove.mono(11), maxLines = 1) }
            task.activity?.let { Dot(); ElapsedClock(it) }
        }
        Spacer(Modifier.weight(1f))
        if (showMode) Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            ModeLabel(stringResource(R.string.detail_fit), fit) { onFit(true) }
            Text("·", color = Rove.c.muted, style = Rove.mono(12))
            ModeLabel(stringResource(R.string.detail_watch), !fit) { onFit(false) }
        }
    }
}

@Composable private fun Dot() { Text("·", color = Rove.c.muted, style = Rove.mono(11)) }

@Composable private fun ModeLabel(text: String, on: Boolean, onClick: () -> Unit) {
    Text(text, Modifier.pressable(onClick = onClick).padding(vertical = 4.dp), color = if (on) Rove.c.accent else Rove.c.muted,
        style = Rove.mono(12, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
}

/** Elapsed time since the activity began: the snapshot's `forMs` plus the time since it arrived. */
@Composable private fun ElapsedClock(activity: TaskActivity) {
    val received = remember(activity) { SystemClock.elapsedRealtime() }
    var now by remember(activity) { mutableLongStateOf(received) }
    LaunchedEffect(activity) { while (true) { delay(1000); now = SystemClock.elapsedRealtime() } }
    Text(clock(activity.forMs + (now - received)), color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, softWrap = false)
}

// `9s`, `4m07s`, `2h03m`, then days (iOS `TaskListLogic.clock`).
private fun clock(ms: Double): String {
    val s = maxOf((ms / 1000).toInt(), 0)
    return when {
        s < 60 -> "${s}s"
        s < 3600 -> String.format(Locale.ROOT, "%dm%02ds", s / 60, s % 60)
        s < 86400 -> String.format(Locale.ROOT, "%dh%02dm", s / 3600, s % 3600 / 60)
        else -> "${s / 86400}d"
    }
}

/** The TUI's tab-strip vocabulary: a spinner, `?` needs input, `!` error, `◷` rate limited, `†` exited, `○` quiet. */
private enum class Glyph(val symbol: String) { Working("⠿"), NeedsInput("?"), Error("!"), RateLimited("◷"), Exited("†"), Quiet("○") }

private fun glyphOf(tab: TabRow, state: String?) = if (tab.alive == false) Glyph.Exited else when (state) {
    "running" -> Glyph.Working
    "permission_needed", "needs_input" -> Glyph.NeedsInput
    "error" -> Glyph.Error
    "rate_limited" -> Glyph.RateLimited
    "dead" -> Glyph.Exited
    else -> Glyph.Quiet
}

@Composable private fun Glyph.tint(): Color = when (this) {
    Glyph.Working, Glyph.NeedsInput -> Rove.c.accent
    Glyph.Error -> Rove.c.error
    else -> Rove.c.muted
}

/** Terminal tabs in the TUI's bracket grammar (`[ ? codex ]`), then diff and land. */
@Composable private fun TabStrip(tabs: List<TabRow>, selected: String?, states: Map<String, String>, diff: DiffStat?, connected: Boolean,
                                 onSelect: (String) -> Unit, onNewTab: () -> Unit, onDiff: () -> Unit, onLand: () -> Unit) {
    val line = Rove.c.line
    Row(Modifier.fillMaxWidth().drawBehind {
        drawLine(line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
    }.padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(start = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            tabs.forEach { tab -> TabLabel(tab, tab.id == selected, glyphOf(tab, states[tab.id])) { onSelect(tab.id) } }
            Box(Modifier.height(32.dp).pressable(enabled = connected, onClick = onNewTab).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.detail_tab_new), color = Rove.c.muted, style = Rove.mono(13), maxLines = 1, softWrap = false)
            }
        }
        Row(Modifier.height(30.dp).tile(radius = Rove.smallRadius).pressable(onClick = onDiff).padding(horizontal = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            val style = Rove.mono(12, FontWeight.Medium)
            Text(stringResource(R.string.detail_diff), color = Rove.c.ink, style = style, maxLines = 1, softWrap = false)
            if (diff != null && diff.files > 0) {
                Text("+${diff.added}", color = Rove.c.success, style = style, maxLines = 1, softWrap = false)
                Text("−${diff.deleted}", color = Rove.c.error, style = style, maxLines = 1, softWrap = false)
            }
        }
        Box(Modifier.padding(end = 16.dp).height(30.dp).background(Rove.c.accent, RoundedCornerShape(Rove.smallRadius))
            .pressable(enabled = connected, onClick = onLand).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.detail_land), color = Rove.c.paper, style = Rove.mono(12, FontWeight.SemiBold), maxLines = 1, softWrap = false)
        }
    }
}

@Composable private fun TabLabel(tab: TabRow, selected: Boolean, glyph: Glyph, onClick: () -> Unit) {
    val style = Rove.mono(13, if (selected) FontWeight.Bold else FontWeight.Normal)
    Row(Modifier.height(32.dp).pressable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Text(if (selected) "[ " else "  ", color = Rove.c.accent, style = style, softWrap = false)
        Box(Modifier.widthIn(min = 12.dp), contentAlignment = Alignment.Center) {
            if (glyph == Glyph.Working) BrailleSpinner(12)
            else Text(glyph.symbol, color = glyph.tint(), style = Rove.mono(12, FontWeight.SemiBold), softWrap = false)
        }
        Text(" ", style = style)
        Text(tab.displayTitle.lowercase(), color = if (selected) Rove.c.ink else Rove.c.muted, style = style, maxLines = 1, softWrap = false)
        Text(if (selected) " ]" else "  ", color = Rove.c.accent, style = style, softWrap = false)
    }
}

@Composable private fun NoTabState(empty: Boolean, onReopen: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, top = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(if (empty) R.string.detail_no_tabs else R.string.detail_pick_tab), color = Rove.c.ink, style = Rove.mono(13, FontWeight.Medium))
            Text(stringResource(R.string.detail_no_tabs_hint), color = Rove.c.muted, style = Rove.mono(12))
        }
        if (empty) TileLabel(stringResource(R.string.detail_reopen), tint = Rove.c.accent, onClick = onReopen)
    }
}

/** Two-step confirmation for the destructive actions: what it does, then the explicit confirm. */
@Composable private fun ConfirmDialog(action: String, step: Int, busy: Boolean, task: TaskRow?, onDismiss: () -> Unit, onContinue: () -> Unit) {
    val delete = action == "delete"
    AlertDialog(onDismissRequest = onDismiss, containerColor = Rove.c.paper,
        title = {
            Text(stringResource(if (step == 1) (if (delete) R.string.detail_delete_title else R.string.detail_land_title)
                else (if (delete) R.string.detail_delete_confirm_title else R.string.detail_land_confirm_title)),
                color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold))
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (step == 1) {
                    Text(task?.displayTitle.orEmpty(), color = Rove.c.ink, style = Rove.face(15, FontWeight.Medium))
                    if (!task?.branch.isNullOrEmpty()) Text(task!!.branch, color = Rove.c.muted, style = Rove.mono(12))
                }
                Text(stringResource(if (delete) R.string.detail_delete_body else R.string.detail_land_body),
                    color = Rove.c.muted, style = Rove.face(14))
            }
        },
        dismissButton = { TileLabel(stringResource(R.string.detail_cancel), onClick = onDismiss) },
        confirmButton = {
            TileLabel(stringResource(when {
                busy -> R.string.detail_working
                step == 1 -> R.string.detail_continue
                delete -> R.string.detail_delete_confirm
                else -> R.string.detail_land_confirm
            }), tint = if (step == 2 && delete) Rove.c.error else Rove.c.accent, onClick = onContinue)
        })
}
