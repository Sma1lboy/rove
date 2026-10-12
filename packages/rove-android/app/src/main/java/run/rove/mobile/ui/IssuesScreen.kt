package run.rove.mobile.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import run.rove.mobile.R
import run.rove.mobile.data.BridgeFailure
import run.rove.mobile.data.workItemLinks
import run.rove.mobile.data.workItems
import run.rove.mobile.domain.IssueLogic
import run.rove.mobile.domain.WorkItem
import run.rove.mobile.domain.WorkItemLink

/** iOS `IssuesView`: the repo's GitHub issues through `gh` (read-only) with the tasks already started from them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun IssuesScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("issues", Context.MODE_PRIVATE) }
    val scope = rememberCoroutineScope()
    val tasks by model.tasks.collectAsStateWithLifecycle()
    var storedRepo by remember { mutableStateOf(prefs.getString("issues.repo", "").orEmpty()) }
    var repos by remember { mutableStateOf<List<String>?>(null) }
    var reposFailure by remember { mutableStateOf<String?>(null) }
    var mine by remember { mutableStateOf(false) }
    var items by remember { mutableStateOf<List<WorkItem>?>(null) }
    var links by remember { mutableStateOf<List<WorkItemLink>>(emptyList()) }
    var failure by remember { mutableStateOf<String?>(null) }
    var startItem by remember { mutableStateOf<WorkItem?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    val repo = IssueLogic.currentRepo(repos, storedRepo)
    // Changing either half reloads the list.
    val loadKey = "$repo|$mine"
    val key by rememberUpdatedState(loadKey)

    suspend fun load(refresh: Boolean = false) {
        if (repo.isEmpty()) return
        val asked = loadKey
        try {
            val list = model.repository.workItems(repo, mine, refresh)
            val linked = model.repository.workItemLinks(repo)
            if (asked != key) return
            items = list; links = linked; failure = null
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (asked == key) failure = rawMessage(e)
        }
    }

    suspend fun loadRepos() {
        try { repos = model.repository.repos(); reposFailure = null }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            reposFailure = rawMessage(e)
        }
    }

    LaunchedEffect(Unit) { loadRepos() }
    LaunchedEffect(loadKey) { items = null; links = emptyList(); failure = null; load() }

    val pull = rememberPullToRefreshState()
    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(back = back, trailing = {
            val label = stringResource(R.string.issues_refresh)
            Box(Modifier.size(36.dp).pressable { scope.launch { load(refresh = true) } }.semantics { contentDescription = label },
                contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Refresh, null, tint = Rove.c.ink, modifier = Modifier.size(20.dp))
            }
        }) { Text(stringResource(R.string.issues_title), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold)) }
        repos?.takeIf { it.isNotEmpty() }?.let { list ->
            Controls(list, repo, mine, { storedRepo = it; prefs.edit().putString("issues.repo", it).apply() }) { mine = it }
        }
        PullToRefreshBox(refreshing, { scope.launch { refreshing = true; load(); refreshing = false } }, Modifier.weight(1f),
            state = pull, indicator = {
                PullToRefreshDefaults.Indicator(pull, refreshing, Modifier.align(Alignment.TopCenter),
                    containerColor = Rove.c.surface, color = Rove.c.accent)
            }) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val list = repos
                val shown = items
                when {
                    reposFailure != null -> item { FailureBlock(reposFailure.orEmpty()) { scope.launch { loadRepos() } } }
                    list != null && list.isEmpty() -> item {
                        EmptyState(stringResource(R.string.issues_no_repos), stringResource(R.string.issues_no_repos_detail),
                            Modifier.padding(horizontal = 4.dp, vertical = 12.dp))
                    }
                    failure != null -> item { FailureBlock(failure.orEmpty()) { scope.launch { load() } } }
                    shown != null -> {
                        if (shown.isEmpty()) item {
                            EmptyState(stringResource(R.string.issues_empty), stringResource(R.string.issues_empty_detail),
                                Modifier.padding(horizontal = 4.dp, vertical = 12.dp))
                        }
                        items(shown, key = { it.number }) { item ->
                            val linked = IssueLogic.linkedTask(item, links)
                            IssueRow(item, linked, linked?.let { id -> tasks.tasks.firstOrNull { it.id == id }?.group }) {
                                // An issue that already has a task opens it; a second one is never created.
                                if (linked != null) open(Route.Task(linked)) else startItem = item
                            }
                        }
                    }
                    else -> item {
                        Row(Modifier.padding(horizontal = 4.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            BrailleSpinner(13)
                            Text(stringResource(R.string.issues_loading), color = Rove.c.muted, style = Rove.mono(13))
                        }
                    }
                }
            }
        }
    }

    startItem?.let { picked ->
        StartIssueSheet(model, repo, picked, dismiss = { startItem = null }) { taskId ->
            startItem = null
            open(Route.Task(taskId))
            scope.launch { load() }
        }
    }
}

/** A `gh` failure's raw text; a normal state of this page, not a crash. */
private fun rawMessage(e: Exception): String =
    (e as? BridgeFailure)?.let { it.message?.ifEmpty { null } ?: it.code } ?: e.message ?: e.toString()

@Composable private fun Controls(repos: List<String>, repo: String, mine: Boolean, onRepo: (String) -> Unit, onMine: (Boolean) -> Unit) {
    Column(Modifier.padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            repos.forEach { path ->
                val on = path == repo
                Box(Modifier.heightIn(min = 40.dp).selectableTile(on).pressable { onRepo(path) }, contentAlignment = Alignment.Center) {
                    Text(path.trimEnd('/').substringAfterLast('/'), Modifier.padding(horizontal = 12.dp),
                        color = if (on) Rove.c.accent else Rove.c.ink,
                        style = Rove.mono(13, if (on) FontWeight.SemiBold else FontWeight.Normal), maxLines = 1)
                }
            }
        }
        Box(Modifier.padding(horizontal = 16.dp)) {
            val labels = mapOf(false to stringResource(R.string.issues_all), true to stringResource(R.string.issues_mine))
            ChoiceTiles(listOf(false, true), mine, { labels.getValue(it) }, onMine)
        }
    }
}

/** The hint is the headline; the raw message stays muted below it unless it already is the headline. */
@Composable private fun FailureBlock(raw: String, retry: () -> Unit) {
    val headline = when (IssueLogic.failureKind(raw)) {
        "no-remote" -> stringResource(R.string.issues_hint_no_remote)
        "gh-missing" -> stringResource(R.string.issues_hint_gh_missing)
        "auth" -> stringResource(R.string.issues_hint_auth)
        else -> raw
    }
    Column(Modifier.padding(horizontal = 4.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ErrorLine(headline)
        if (raw != headline) Text(raw, Modifier.fillMaxWidth(), color = Rove.c.muted, style = Rove.mono(12))
        Row { TileLabel(stringResource(R.string.issues_retry), onClick = retry) }
    }
}

@Composable private fun IssueRow(item: WorkItem, linkedTask: String?, group: String?, onClick: () -> Unit) {
    val ago = IssueLogic.age(item.updatedAt, System.currentTimeMillis())?.let { stringResource(R.string.issues_ago, it) }
    Column(Modifier.fillMaxWidth().tile().pressable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Text("#${item.number}", color = Rove.c.ink, style = Rove.mono(13, FontWeight.Medium))
            Text(item.title, Modifier.weight(1f), color = Rove.c.ink, style = Rove.face(15, FontWeight.SemiBold),
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(IssueLogic.meta(item, ago), color = Rove.c.muted, style = Rove.mono(12), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (linkedTask != null) Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.issues_task), color = Rove.c.muted, style = Rove.mono(11, FontWeight.Medium))
            if (group != null) StatusTag(group)
            Text(stringResource(R.string.issues_opens_task), color = Rove.c.muted, style = Rove.mono(11))
        }
    }
}
