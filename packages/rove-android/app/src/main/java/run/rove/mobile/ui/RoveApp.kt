package run.rove.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import run.rove.mobile.R

@Composable fun RoveApp(model: AppModel, pairingUrl: String, onUrl: (String) -> Unit,
                        scan: () -> Unit) {
    val paired by model.paired.collectAsStateWithLifecycle()
    val demo by model.demo.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    // Screens above the task list, newest last (iOS NavigationStack path).
    var stack by remember { mutableStateOf(listOf<Route>()) }
    var create by remember { mutableStateOf(false) }
    val open: (Route) -> Unit = { stack = stack + it }
    // The list leaves composition while a page is on top; this keeps its filter, search and scroll.
    val saved = rememberSaveableStateHolder()
    val pop: () -> Unit = { stack = stack.dropLast(1) }
    val leave = { model.unpair(); stack = emptyList() }
    LaunchedEffect(paired) { if (!paired) stack = emptyList() }
    BackHandler(stack.isNotEmpty(), pop)
    // A focusable root absorbs the initial focus Compose grants in non-touch mode (after any key
    // event), so launching never lands on the pairing field and raises the keyboard.
    Column(Modifier.fillMaxSize().background(Rove.c.paper).focusable()) {
        // iOS DemoStrip: its inset fill runs up under the status bar.
        if (demo) Column(Modifier.background(Rove.c.inset).windowInsetsPadding(WindowInsets.statusBars)) { DemoStrip(leave) }
        else Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        Column(Modifier.weight(1f).windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))) {
            if (!paired) PairingScreen(pairingUrl, onUrl, scan, model::pair, model::startDemo)
            else when (val top = stack.lastOrNull()) {
                null -> saved.SaveableStateProvider("list") {
                    TaskListScreen(model, onSelect = { open(Route.Task(it)) }, onCreate = { create = true }, open = open)
                }
                is Route.Task -> key(top) { TaskDetailScreen(model, top.id, pop, top.tab) }
                Route.Inbox -> InboxScreen(model, pop, open)
                Route.Board -> BoardScreen(model, pop, open)
                Route.Routines -> RoutinesScreen(model, pop, open)
                Route.Issues -> IssuesScreen(model, pop, open)
                Route.Worktrees -> WorktreesScreen(model, pop, open)
                Route.Settings -> SettingsScreen(model, pop, open)
            }
        }
    }
    if (create) CreateSheet(model, null, { create = false }, { open(Route.Task(it)); create = false })
    if (error != null) AlertDialog(onDismissRequest = { model.error.value = null }, containerColor = Rove.c.paper,
        title = { Text(stringResource(R.string.app_error_title), color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
        text = { Text(error!!, color = Rove.c.muted, style = Rove.mono(13)) },
        confirmButton = { TileLabel(stringResource(R.string.app_close), onClick = { model.error.value = null }) })
}
