package run.rove.mobile.ui

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import run.rove.mobile.data.*
import run.rove.mobile.domain.*

/** A bridge error as one line: `CODE: message`, or [fallback] when the failure carries no text. */
internal fun Throwable.boardMessage(fallback: String): String = when {
    this is BridgeFailure -> "$code: $message"
    else -> message?.takeIf { it.isNotEmpty() } ?: fallback
}

/**
 * Load state of the Kanban board (iOS `BoardModel`): which projects exist, the selected project's stories, and the
 * one-line notices. A failed refresh keeps the last data and only sets an error.
 */
@Stable class BoardModel(
    private val repository: RoveRepository,
    private val prefs: BoardPrefs,
    private val scope: CoroutineScope,
    private val fallback: String,
) {
    var projects by mutableStateOf<List<String>>(emptyList()); private set
    var projectsLoaded by mutableStateOf(false); private set
    /** The selected project: an absolute path straight from the repo list (never rewritten). */
    var repo by mutableStateOf(""); private set
    var issues by mutableStateOf<RepoIssues?>(null); private set
    private var projectsError by mutableStateOf<String?>(null)
    private var issuesError by mutableStateOf<String?>(null)
    /** Best-effort steps of a started session that failed; shown until dismissed. */
    var warnings by mutableStateOf<List<StartWarning>>(emptyList())
    /** The story a session was just started from in the background; clears itself after ~3s. */
    var notice by mutableStateOf<Int?>(null); private set

    private var seq = 0
    private var ticks = 0
    private var noticeSeq = 0

    val error get() = issuesError ?: projectsError

    /** One auto-refresh tick (every 5s): the project list is re-read now and then, the stories every time. */
    suspend fun refresh(force: Boolean = false) {
        if (force || projects.isEmpty() || ticks % 6 == 0) loadProjects()
        ticks += 1
        reload()
    }

    private suspend fun loadProjects() {
        var issueRepos = emptyList<String>()
        var known = emptyList<String>()
        var failure: String? = null
        try { issueRepos = repository.issueRepos() } catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure = e.boardMessage(fallback) }
        try { known = repository.repos() } catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure = failure ?: e.boardMessage(fallback) }
        val list = BoardLogic.projects(issueRepos, known)
        // Both reads failing keeps the last list rather than emptying the board.
        if (!(failure != null && list.isEmpty())) projects = list
        projectsError = failure
        projectsLoaded = true
        val next = pick(prefs.repo)
        if (next != repo) { repo = next; issues = null; issuesError = null; if (next.isNotEmpty()) prefs.repo = next }
    }

    private fun pick(preferred: String): String {
        if (repo in projects) return repo
        val key = BoardLogic.repoKey(preferred)
        if (preferred.isNotEmpty()) projects.firstOrNull { BoardLogic.repoKey(it) == key }?.let { return it }
        return projects.firstOrNull().orEmpty()
    }

    suspend fun select(path: String) {
        if (path == repo) return
        repo = path
        prefs.repo = path
        issues = null
        issuesError = null
        reload()
    }

    /** Only the newest request for the current project may land; older ones are dropped. */
    suspend fun reload() {
        val target = repo
        if (target.isEmpty()) return
        val mine = ++seq
        try {
            val result = repository.issueList(target)
            if (mine != seq || target != repo) return
            issues = result
            issuesError = null
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (mine != seq || target != repo) return
            issuesError = e.boardMessage(fallback)
        }
    }

    fun flash(storyId: Int) {
        notice = storyId
        val mine = ++noticeSeq
        scope.launch { delay(3000); if (noticeSeq == mine) notice = null }
    }
}
