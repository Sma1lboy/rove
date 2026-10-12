package run.rove.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import run.rove.mobile.R
import run.rove.mobile.domain.*

private sealed interface Target {
    data class File(val file: DiffFile) : Target
    data class Combined(val path: String) : Target
}

private sealed interface Phase {
    data object Loading : Phase
    data class Loaded(val result: DiffContent) : Phase
    data class Failed(val message: String) : Phase
}

/** The files screen for one task and its diffs (iOS `DiffFilesView` → `DiffFileView` / `CombinedDiffView`): back steps file → list → out. */
@Composable fun DiffScreen(model: AppModel, taskId: String, back: () -> Unit) {
    var target by remember(taskId) { mutableStateOf<Target?>(null) }
    var scope by remember(taskId) { mutableStateOf("working") }
    var reload by remember(taskId) { mutableIntStateOf(0) }
    var files by remember(taskId) { mutableStateOf<DiffFiles?>(null) }
    var error by remember(taskId) { mutableStateOf<String?>(null) }
    var loaded by remember(taskId) { mutableStateOf(false) }
    LaunchedEffect(taskId, reload) {
        try {
            val result = model.repository.diffFiles(taskId)
            files = result; error = null
            if (result.files.none { it.scope == scope }) result.files.firstOrNull()?.let { scope = it.scope }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { error = e.message ?: e.toString() }
        loaded = true
    }
    val up: () -> Unit = { if (target != null) { target = null } else { back() } }
    BackHandler(onBack = up)
    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        when (val t = target) {
            null -> {
                ScreenHeader(up, trailing = { RefreshButton { reload++ } }) {
                    Text(stringResource(R.string.diff_files), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold))
                }
                FilesList(files?.base, files?.files.orEmpty().filter { it.scope == scope }, loaded, error, scope, { scope = it },
                    { reload++ }, { target = Target.File(it) }, { target = Target.Combined(it) })
            }
            is Target.File -> FileDiff(model, taskId, t.file, files?.base, up)
            is Target.Combined -> CombinedDiff(model, taskId, t.path, files?.base, scope, up)
        }
    }
}

// MARK: Files list

@Composable private fun FilesList(base: String?, visible: List<DiffFile>, loaded: Boolean, error: String?, scope: String,
                                  onScope: (String) -> Unit, onRetry: () -> Unit, onFile: (DiffFile) -> Unit, onCombined: (String) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (error != null) {
            ErrorLine(error)
            TileLabel(stringResource(R.string.diff_retry), tint = Rove.c.accent, onClick = onRetry)
            return@Column
        }
        val baseName = base ?: stringResource(R.string.diff_its_base)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ScopeTiles(base, scope, onScope)
            Text(if (scope == "working") stringResource(R.string.diff_working_caption) else stringResource(R.string.diff_branch_caption, baseName),
                color = Rove.c.muted, style = Rove.mono(12))
        }
        when {
            !loaded -> Loading()
            visible.isEmpty() -> EmptyState(stringResource(R.string.diff_no_changes),
                if (scope == "working") stringResource(R.string.diff_worktree_clean) else stringResource(R.string.diff_branch_clean, baseName))
            else -> {
                CombinedRow(stringResource(R.string.diff_whole_worktree), pluralStringResource(R.plurals.diff_all_as_one, visible.size, visible.size)) { onCombined(".") }
                DiffParse.groups(visible).forEach { g ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (g.dir.isNotEmpty()) CombinedRow(g.dir, pluralStringResource(R.plurals.diff_dir_combined, g.files.size, g.files.size)) { onCombined(g.dir) }
                        Column(Modifier.fillMaxWidth().tile()) { g.files.forEach { FileRow(it, g.dir.isNotEmpty()) { onFile(it) } } }
                    }
                }
            }
        }
    }
}

@Composable private fun CombinedRow(title: String, detail: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(Rove.radius)).pressable(onClick = onClick)
        .tile(Rove.c.accentSoft, border = Rove.c.accent).heightIn(min = 44.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Modifier.weight(1f), color = Rove.c.accent, style = Rove.mono(13, FontWeight.SemiBold), maxLines = 1,
            overflow = TextOverflow.StartEllipsis)
        Text(detail, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1)
    }
}

@Composable private fun FileRow(file: DiffFile, inGroup: Boolean, onClick: () -> Unit) {
    val status = when (file.status) { "D" -> Rove.c.error; "A", "?" -> Rove.c.success; else -> Rove.c.muted }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(Rove.smallRadius)).pressable(onClick = onClick)
        .heightIn(min = 44.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(file.status, Modifier.width(18.dp), color = status, style = Rove.mono(12, FontWeight.SemiBold))
        Text(if (inGroup) file.path.substringAfterLast('/') else file.path, Modifier.weight(1f), color = Rove.c.ink,
            style = Rove.mono(13), maxLines = 1, overflow = TextOverflow.StartEllipsis)
        file.added?.let { Text("+$it", color = Rove.c.success, style = Rove.mono(12)) }
        file.deleted?.let { Text("\u2212$it", color = Rove.c.error, style = Rove.mono(12)) }
    }
}

// MARK: One file

@Composable private fun FileDiff(model: AppModel, taskId: String, file: DiffFile, base: String?, back: () -> Unit) {
    var reload by remember { mutableIntStateOf(0) }
    val phase by rememberPhase(model, taskId, file, reload)
    ScreenHeader(back, trailing = { RefreshButton { reload++ } }) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(file.path.substringAfterLast('/'), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold), maxLines = 1,
                overflow = TextOverflow.Ellipsis)
            Text(file.path, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
        }
    }
    val loaded = (phase as? Phase.Loaded)?.result
    Column(Modifier.fillMaxWidth().bottomLine().padding(start = 20.dp, end = 20.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Meta(scopeTitle(file.scope, base), Rove.c.muted)
            if (loaded?.kind == "diff") DiffParse.counts(loaded.text.orEmpty()).let {
                Meta("+${it.added}", Rove.c.success); Meta("\u2212${it.deleted}", Rove.c.error)
            } else if (loaded?.kind == "code") {
                Meta("·", Rove.c.muted); Meta(stringResource(R.string.diff_read_only_preview), Rove.c.muted)
            }
        }
        loaded?.origPath?.let { Meta(stringResource(R.string.diff_renamed_from, it), Rove.c.muted, overflow = TextOverflow.StartEllipsis) }
    }
    when (val p = phase) {
        Phase.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { Loading() }
        is Phase.Failed -> Failure(p.message) { reload++ }
        is Phase.Loaded -> {
            val r = p.result
            val state = diffStateText(r)
            when {
                r.kind == "error" -> Failure(r.message ?: stringResource(R.string.diff_no_reason)) { reload++ }
                state != null -> EmptyState(state.first, state.second, Modifier.padding(20.dp))
                else -> DiffLines(if (r.kind == "diff") DiffParse.lines(r.text.orEmpty()) else DiffParse.codeLines(r.text.orEmpty()), Modifier.fillMaxSize())
            }
        }
    }
}

// MARK: Combined

@Composable private fun CombinedDiff(model: AppModel, taskId: String, path: String, base: String?, initialScope: String, back: () -> Unit) {
    var scope by remember { mutableStateOf(initialScope) }
    var reload by remember { mutableIntStateOf(0) }
    val phase by rememberPhase(model, taskId, DiffFile(path, "", scope), reload)
    val title = if (path == ".") stringResource(R.string.diff_whole_worktree) else path
    ScreenHeader(back, trailing = { RefreshButton { reload++ } }) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.diff_combined), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold))
            Text(title, color = Rove.c.muted, style = Rove.mono(11), maxLines = 1, overflow = TextOverflow.StartEllipsis)
        }
    }
    val loaded = (phase as? Phase.Loaded)?.result?.takeIf { it.kind == "diff" }
    Column(Modifier.fillMaxWidth().bottomLine().padding(start = 20.dp, end = 20.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ScopeTiles(base, scope) { scope = it }
        if (loaded != null) {
            val sections = DiffParse.sections(loaded.text.orEmpty())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Meta(pluralStringResource(R.plurals.diff_file_count, sections.size, sections.size), Rove.c.muted)
                Meta("+${sections.sumOf { it.added }}", Rove.c.success)
                Meta("\u2212${sections.sumOf { it.deleted }}", Rove.c.error)
                Spacer(Modifier.weight(1f))
                Meta(stringResource(R.string.diff_read_only), Rove.c.muted)
            }
        } else Text(stringResource(R.string.diff_combined_hint), color = Rove.c.muted, style = Rove.mono(12))
    }
    when (val p = phase) {
        Phase.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { Loading() }
        is Phase.Failed -> Failure(p.message) { reload++ }
        is Phase.Loaded -> when {
            p.result.kind == "error" -> Failure(p.result.message ?: stringResource(R.string.diff_no_reason)) { reload++ }
            p.result.kind == "diff" -> DiffLines(DiffParse.lines(p.result.text.orEmpty()), Modifier.fillMaxSize())
            else -> EmptyState(stringResource(R.string.diff_no_changes), stringResource(R.string.diff_combined_empty, title), Modifier.padding(20.dp))
        }
    }
}

// MARK: Shared pieces

@Composable private fun rememberPhase(model: AppModel, taskId: String, file: DiffFile, reload: Int): State<Phase> =
    produceState<Phase>(Phase.Loading, taskId, file, reload) {
        value = Phase.Loading
        value = try { Phase.Loaded(model.repository.diffFile(taskId, file)) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { Phase.Failed(e.message ?: e.toString()) }
    }

@Composable private fun scopeTitle(scope: String, base: String?): String =
    if (scope == "branch") stringResource(R.string.diff_scope_branch, base ?: stringResource(R.string.diff_base))
    else stringResource(R.string.diff_scope_working)

@Composable private fun ScopeTiles(base: String?, scope: String, onScope: (String) -> Unit) {
    val options = if (base == null) listOf("working") else listOf("working", "branch")
    val titles = options.associateWith { scopeTitle(it, base) }
    ChoiceTiles(options, scope, titles::getValue, onScope)
}

@Composable private fun Meta(text: String, color: Color, overflow: TextOverflow = TextOverflow.Clip) {
    Text(text, color = color, style = Rove.mono(12, FontWeight.Medium), maxLines = 1, overflow = overflow)
}

@Composable private fun Loading() {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        BrailleSpinner(14, Rove.c.muted)
        Text(stringResource(R.string.diff_loading), color = Rove.c.muted, style = Rove.mono(12))
    }
}

@Composable private fun Failure(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ErrorLine(message)
        TileLabel(stringResource(R.string.diff_retry), tint = Rove.c.accent, onClick = onRetry)
    }
}

@Composable private fun RefreshButton(onClick: () -> Unit) {
    val label = stringResource(R.string.diff_refresh)
    Box(Modifier.size(36.dp).pressable(onClick = onClick).semantics { contentDescription = label }, Alignment.Center) {
        Icon(Icons.Filled.Refresh, null, Modifier.size(20.dp), tint = Rove.c.muted)
    }
}

@Composable private fun Modifier.bottomLine(): Modifier {
    val line = Rove.c.line
    return drawBehind { drawLine(line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
}
