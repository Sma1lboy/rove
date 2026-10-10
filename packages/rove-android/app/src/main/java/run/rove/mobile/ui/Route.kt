package run.rove.mobile.ui

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
