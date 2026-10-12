package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

// Port of iOS Files/WorktreesView.swift: every worktree of every saved project, with what a person needs before deleting one.

private sealed interface LoadPhase {
    data object Loading : LoadPhase
    data class Loaded(val projects: List<WorktreeProject>) : LoadPhase
    data class Failed(val message: String) : LoadPhase
}

@Composable fun WorktreesScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    var phase by remember { mutableStateOf<LoadPhase>(LoadPhase.Loading) }
    var reload by remember { mutableIntStateOf(0) }
    var acting by remember { mutableStateOf<WorktreeRow?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(reload) {
        try { phase = LoadPhase.Loaded(model.repository.worktrees()) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { phase = LoadPhase.Failed(e.message ?: e.toString()) }
    }

    Column(Modifier.fillMaxSize().background(Rove.c.paper).statusBarsPadding()) {
        ScreenHeader(back, trailing = { RefreshButton { reload++ } }) {
            Text(stringResource(R.string.worktrees_title), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold))
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp)
            .navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            notice?.let { Text(it, color = Rove.c.muted, style = Rove.mono(12)) }
            when (val p = phase) {
                is LoadPhase.Failed -> {
                    ErrorLine(p.message)
                    TileLabel(stringResource(R.string.worktrees_retry), tint = Rove.c.accent) { phase = LoadPhase.Loading; reload++ }
                }
                LoadPhase.Loading -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    BrailleSpinner(14, Rove.c.muted)
                    Text(stringResource(R.string.worktrees_loading), color = Rove.c.muted, style = Rove.mono(12))
                }
                is LoadPhase.Loaded -> if (p.projects.isEmpty()) {
                    EmptyState(stringResource(R.string.worktrees_no_projects), stringResource(R.string.worktrees_no_projects_detail))
                } else p.projects.forEach { Project(it) { row -> acting = row } }
            }
        }
    }

    acting?.let { row ->
        WorktreeActionSheet(model, row, onDismiss = { acting = null }, open = { acting = null; open(it) }) { message ->
            notice = message
            reload++
        }
    }
}

@Composable private fun Project(project: WorktreeProject, onPick: (WorktreeRow) -> Unit) {
    FormSection(WorktreesLogic.projectName(project.repo), trailing = "${project.worktrees.size}") {
        if (project.worktrees.isEmpty()) {
            Text(stringResource(R.string.worktrees_none), color = Rove.c.muted, style = Rove.mono(12))
        } else Column(Modifier.fillMaxWidth().tile()) {
            project.worktrees.forEach { row -> RowView(row) { onPick(row) } }
        }
    }
}

@Composable private fun RowView(row: WorktreeRow, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().pressable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(branchName(row), Modifier.weight(1f), color = Rove.c.ink, style = Rove.mono(13, FontWeight.SemiBold), maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis)
            WorktreesLogic.age(row.lastActivityMs ?: row.createdAtMs)?.let {
                Text(ageText(it), color = Rove.c.muted, style = Rove.mono(11))
            }
        }
        Tags(row, 11)
        Text(row.path, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
    }
}

@Composable private fun Tags(row: WorktreeRow, size: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        WorktreesLogic.tags(row).forEach { Text(tagText(it.kind), color = toneColor(it.tone), style = Rove.mono(size, FontWeight.Medium), maxLines = 1) }
    }
}

@Composable private fun branchName(row: WorktreeRow) = row.branch.ifEmpty { stringResource(R.string.worktrees_detached) }

@Composable private fun toneColor(tone: WorktreeTone): Color = when (tone) {
    WorktreeTone.Quiet -> Rove.c.muted
    WorktreeTone.Good -> Rove.c.success
    WorktreeTone.Warn -> Rove.c.accent
}

@Composable private fun tagText(kind: WorktreeTagKind) = stringResource(when (kind) {
    WorktreeTagKind.Rove -> R.string.worktrees_tag_rove
    WorktreeTagKind.Dirty -> R.string.worktrees_tag_dirty
    WorktreeTagKind.DirtyUnknown -> R.string.worktrees_tag_dirty_unknown
    WorktreeTagKind.OnRemote -> R.string.worktrees_tag_on_remote
    WorktreeTagKind.NotPushed -> R.string.worktrees_tag_not_pushed
    WorktreeTagKind.RemoteUnknown -> R.string.worktrees_tag_remote_unknown
    WorktreeTagKind.PrOpen -> R.string.worktrees_tag_pr_open
    WorktreeTagKind.PrMerged -> R.string.worktrees_tag_pr_merged
    WorktreeTagKind.InMain -> R.string.worktrees_tag_in_main
    WorktreeTagKind.PrClosed -> R.string.worktrees_tag_pr_closed
    WorktreeTagKind.Idle -> R.string.worktrees_tag_idle
})

@Composable private fun ageText(age: WorktreeAge) = stringResource(when (age.unit) {
    AgeUnit.Minutes -> R.string.worktrees_age_m
    AgeUnit.Hours -> R.string.worktrees_age_h
    AgeUnit.Days -> R.string.worktrees_age_d
    AgeUnit.Months -> R.string.worktrees_age_mo
}, age.value)

@Composable private fun RefreshButton(onClick: () -> Unit) {
    val label = stringResource(R.string.worktrees_refresh)
    Box(Modifier.size(36.dp).pressable(onClick = onClick).semantics { contentDescription = label }, Alignment.Center) {
        Icon(Icons.Filled.Refresh, null, Modifier.size(20.dp), tint = Rove.c.muted)
    }
}

/** What can be done to one worktree. Land and remove are confirmed; forcing a dirty removal is a second confirm quoting git's reason. */
@Composable private fun WorktreeActionSheet(model: AppModel, row: WorktreeRow, onDismiss: () -> Unit, open: (Route) -> Unit,
                                            done: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var confirmRemove by remember { mutableStateOf(false) }
    var confirmLand by remember { mutableStateOf(false) }
    var dirtyReason by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val name = row.branch.ifEmpty { row.path }
    val removedText = stringResource(R.string.worktrees_removed, name)
    val notRemoved = stringResource(R.string.worktrees_not_removed)
    val context = LocalContext.current

    fun fail(e: Exception) { error = (e as? BridgeFailure)?.let { it.message?.ifEmpty { null } ?: it.code } ?: e.message ?: e.toString() }

    fun remove(force: Boolean) = scope.launch {
        busy = true
        try {
            val r = model.repository.removeWorktree(row.path, force)
            val base = if (r.removed) removedText else notRemoved
            done(r.residue?.let { "$base\n" + context.getString(R.string.worktrees_residue, it.path, it.reason) } ?: base)
            onDismiss()
        } catch (e: CancellationException) { throw e }
        catch (e: BridgeFailure) {
            if (e.code == "DIRTY_WORKTREE" && !force) dirtyReason = e.message.orEmpty() else fail(e) // second, explicit confirm with git's own reason
        } catch (e: Exception) { fail(e) }
        finally { busy = false }
    }

    fun land(strategy: String) = scope.launch {
        val taskId = row.taskId ?: return@launch
        busy = true
        try {
            val r = model.repository.landWorktree(taskId, strategy)
            done(context.getString(R.string.worktrees_landed, r.landedOn, r.commit.take(8)))
            onDismiss()
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { fail(e) }
        finally { busy = false }
    }

    SheetScaffold(branchName(row), onDismiss, kicker = stringResource(R.string.worktrees_kicker), error = error) {
        Text(row.path, color = Rove.c.muted, style = Rove.mono(12))
        Tags(row, 12)
        Column(Modifier.fillMaxWidth().tile()) {
            row.taskId?.let { id -> ActionRow(stringResource(R.string.worktrees_open_task), id) { open(Route.Task(id)) } }
            if (row.canLand) ActionRow(stringResource(R.string.worktrees_land), stringResource(R.string.worktrees_land_detail)) { confirmLand = true }
            else Text(stringResource(R.string.worktrees_untracked), Modifier.padding(14.dp), color = Rove.c.muted, style = Rove.mono(12))
            ActionRow(stringResource(R.string.worktrees_remove), if (row.dirty == true) stringResource(R.string.worktrees_remove_detail) else null,
                tint = Rove.c.error) { confirmRemove = true }
        }
        if (busy) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            BrailleSpinner(14, Rove.c.muted)
            Text(stringResource(R.string.worktrees_working), color = Rove.c.muted, style = Rove.mono(12))
        }
    }

    if (confirmRemove) Confirm(stringResource(R.string.worktrees_remove_title), stringResource(R.string.worktrees_remove_message, row.path),
        listOf(Choice(stringResource(R.string.worktrees_remove_confirm), destructive = true) { remove(false) })) { confirmRemove = false }
    if (confirmLand) Confirm(stringResource(R.string.worktrees_land_title), stringResource(R.string.worktrees_land_message, row.branch),
        listOf(Choice(stringResource(R.string.worktrees_merge)) { land("merge") }, Choice(stringResource(R.string.worktrees_squash)) { land("squash") })) {
        confirmLand = false
    }
    dirtyReason?.let { reason ->
        Confirm(stringResource(R.string.worktrees_force_title), reason + "\n\n" + stringResource(R.string.worktrees_force_hint),
            listOf(Choice(stringResource(R.string.worktrees_force_confirm), destructive = true) { remove(true) })) { dirtyReason = null }
    }
}

private class Choice(val label: String, val destructive: Boolean = false, val run: () -> Unit)

@Composable private fun Confirm(title: String, message: String, choices: List<Choice>, dismiss: () -> Unit) {
    AlertDialog(onDismissRequest = dismiss, containerColor = Rove.c.paper,
        title = { Text(title, color = Rove.c.ink, style = Rove.face(17, FontWeight.SemiBold)) },
        text = { Text(message, color = Rove.c.muted, style = Rove.mono(12)) },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End) {
                choices.forEach { c ->
                    TextButton({ dismiss(); c.run() }) {
                        Text(c.label, color = if (c.destructive) Rove.c.error else Rove.c.accent, style = Rove.mono(14, FontWeight.Medium))
                    }
                }
            }
        },
        dismissButton = { TextButton(dismiss) { Text(stringResource(R.string.worktrees_cancel), color = Rove.c.muted, style = Rove.mono(14)) } })
}
