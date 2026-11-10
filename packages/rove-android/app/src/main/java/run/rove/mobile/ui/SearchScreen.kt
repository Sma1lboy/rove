package run.rove.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import run.rove.mobile.R
import run.rove.mobile.data.searchSessions
import run.rove.mobile.domain.*

// packages/rove-web/src/search-view.tsx: what was said in any task's conversations, newest session first.

private const val DEBOUNCE_MS = 300L

@Composable fun SearchScreen(model: AppModel, back: () -> Unit, open: (Route) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var state by remember { mutableStateOf<SearchState>(SearchState.Idle) }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < SearchLogic.MIN_CHARS) { state = SearchState.Idle; return@LaunchedEffect }
        delay(DEBOUNCE_MS)
        state = SearchState.Searching
        state = searchResult(q) { model.repository.searchSessions(q) }
    }
    SearchContent(query, { query = it }, state, back) { open(Route.Task(it.taskId, it.tabId)) }
}

@Composable internal fun SearchContent(query: String, onQuery: (String) -> Unit, state: SearchState, back: () -> Unit,
                                       nowMs: Long = System.currentTimeMillis(), autofocus: Boolean = true, onHit: (SearchHit) -> Unit) {
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    if (autofocus) LaunchedEffect(Unit) { focus.requestFocus() }
    Column(Modifier.fillMaxSize().background(Rove.c.paper)) {
        ScreenHeader(back) { Text(stringResource(R.string.search_title), color = Rove.c.ink, style = Rove.face(16, FontWeight.SemiBold)) }
        FieldBox(query, onQuery, stringResource(R.string.search_placeholder),
            Modifier.padding(horizontal = 16.dp).padding(bottom = 6.dp).focusRequester(focus),
            keyboard = KeyboardOptions(imeAction = ImeAction.Search), actions = KeyboardActions(onSearch = { keyboard?.hide() }))
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            when (state) {
                SearchState.Idle -> item { Notice(stringResource(R.string.search_hint)) }
                SearchState.Searching -> item { Notice(stringResource(R.string.search_searching)) }
                is SearchState.Failed -> item { Text(state.message, color = Rove.c.error, style = Rove.mono(12)) }
                is SearchState.Done -> {
                    if (state.reply.matches.isEmpty()) item { Notice(stringResource(R.string.search_none, state.query)) }
                    itemsIndexed(state.reply.matches, key = { i, hit -> "${hit.taskId}:${hit.at}:$i" }) { _, hit ->
                        HitRow(hit, state.query, nowMs) { onHit(hit) }
                    }
                    if (state.reply.truncated) item { Notice(stringResource(R.string.search_truncated)) }
                    val skipped = state.reply.skipped.size
                    if (skipped > 0) item { Notice(pluralStringResource(R.plurals.search_skipped, skipped, skipped)) }
                }
            }
        }
    }
}

@Composable private fun Notice(text: String) { Text(text, color = Rove.c.muted, style = Rove.mono(12)) }

@Composable private fun HitRow(hit: SearchHit, query: String, nowMs: Long, onClick: () -> Unit) {
    val mark = SpanStyle(color = Rove.c.accent, fontWeight = FontWeight.SemiBold)
    val who = stringResource(if (hit.role == "user") R.string.search_you else R.string.search_agent)
    Column(Modifier.fillMaxWidth().pressable(onClick = onClick).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(hit.title, Modifier.weight(1f), color = Rove.c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = Rove.mono(13, FontWeight.Medium))
            val age = IssueLogic.age(hit.at, nowMs)
            Text(if (age == null) who else "$who · $age", color = Rove.c.muted, maxLines = 1, style = Rove.mono(11))
        }
        Text(buildAnnotatedString {
            var from = 0
            SearchLogic.matches(hit.snippet, query).forEach { range ->
                append(hit.snippet.substring(from, range.first))
                withStyle(mark) { append(hit.snippet.substring(range.first, range.last + 1)) }
                from = range.last + 1
            }
            append(hit.snippet.substring(from))
        }, color = Rove.c.muted, maxLines = 3, overflow = TextOverflow.Ellipsis, style = Rove.mono(12))
    }
}
