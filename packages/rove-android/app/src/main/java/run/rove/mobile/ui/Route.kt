package run.rove.mobile.ui

import androidx.compose.runtime.saveable.Saver

/** The screens RoveApp stacks above the task list (iOS `Route`). */
sealed interface Route {
    data class Task(val id: String, val tab: String? = null) : Route
    data object Inbox : Route
    data object Board : Route
    data object Routines : Route
    data object Issues : Route
    data object Worktrees : Route
    data object Settings : Route
}

/** Saves the stack across rotation and process death: a task as `task`, id, tab; a page by its name. */
val RouteStackSaver: Saver<List<Route>, ArrayList<String>> = Saver(
    save = { stack -> stack.flatMapTo(ArrayList()) { r -> if (r is Route.Task) listOf("task", r.id, r.tab.orEmpty()) else listOf(r.toString()) } },
    restore = { flat ->
        val pages = listOf(Route.Inbox, Route.Board, Route.Routines, Route.Issues, Route.Worktrees, Route.Settings).associateBy { it.toString() }
        val out = mutableListOf<Route>()
        var i = 0
        while (i < flat.size) {
            if (flat[i] == "task") { out += Route.Task(flat[i + 1], flat[i + 2].ifEmpty { null }); i += 3 }
            else { pages[flat[i]]?.let { out += it }; i++ }
        }
        out
    })
