package run.rove.mobile.domain

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

// iOS Pages/PagesModels.swift, the Board part: wire models and the pure logic behind the Kanban board.
// Every optional field decodes to a default, so an older or newer bridge never fails a whole list.

/** An unknown wire status reads as open, like iOS. */
@Serializable(with = IssueStatusSerializer::class)
enum class IssueStatus(val wire: String) {
    Open("open"), Doing("doing"), Hold("hold"), Done("done");

    companion object { fun of(raw: String) = entries.firstOrNull { it.wire == raw } ?: Open }
}

object IssueStatusSerializer : KSerializer<IssueStatus> {
    override val descriptor = PrimitiveSerialDescriptor("IssueStatus", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder) = IssueStatus.of(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: IssueStatus) = encoder.encodeString(value.wire)
}

/** One story of the issue store (`rove api issue-list`). */
@Serializable data class Story(
    val id: Int,
    val title: String = "",
    val status: IssueStatus = IssueStatus.Open,
    val created: String = "",
    val body: String = "",
    /** The linked task's id; set when a session was started from the story. */
    val taskId: String? = null,
) {
    val link get() = taskId?.takeIf { it.isNotEmpty() }
    val linked get() = link != null
    /** The body as shown: a description cleared from the phone is stored as one space. */
    val detail get() = body.trim()
}

@Serializable data class RepoIssues(
    val repoRoot: String = "",
    val exists: Boolean = false,
    val nextId: Int = 1,
    val issues: List<Story> = emptyList(),
    /** Records the store could not read; non-zero means `issues` is not the whole board. */
    val skipped: Int = 0,
)

@Serializable data class IssueRepos(val repos: List<String> = emptyList())
@Serializable data class IssuePrompt(val title: String = "", val prompt: String = "")

/** One row of a task's EVENTS snapshot: the engine lifecycle ring, newest first. */
@Serializable data class TaskEvent(val kind: String, val at: Double = 0.0, val tail: String = "")
@Serializable data class TaskEvents(val events: List<TaskEvent> = emptyList())

enum class BoardColumn { Backlog, InProgress, Parked, Done }

data class BoardColumnData(
    val key: BoardColumn,
    val stories: List<Story>,
    /** Parked and Done accrete forever: the newest slice renders, the rest is `+N more`. */
    val hiddenCount: Int = 0,
) {
    /** The whole column, hidden cards included. */
    val total get() = stories.size + hiddenCount
}

data class FloatedColumns(val columns: List<BoardColumnData>, val count: Int)

object BoardLogic {
    const val CAP = 20

    /**
     * Terminal and parked outrank a link; a link (to a task that still exists) is In progress; an unlinked `doing` is
     * In progress too; everything else is Backlog. Pass `taskExists = null` while the task feed has not loaded, so the
     * link alone decides.
     */
    fun column(story: Story, taskExists: ((String) -> Boolean)?): BoardColumn = when (story.status) {
        IssueStatus.Done -> BoardColumn.Done
        IssueStatus.Hold -> BoardColumn.Parked
        IssueStatus.Open, IssueStatus.Doing -> {
            val id = story.link
            if (id != null && (taskExists?.invoke(id) ?: true)) BoardColumn.InProgress
            else if (story.status == IssueStatus.Doing) BoardColumn.InProgress else BoardColumn.Backlog
        }
    }

    /** Newest-created first; id descending as the tiebreak (`created` is day-granular). */
    val newerFirst = Comparator<Story> { a, b -> if (a.created != b.created) b.created.compareTo(a.created) else b.id.compareTo(a.id) }

    fun columns(stories: List<Story>, taskExists: ((String) -> Boolean)?): List<BoardColumnData> {
        val buckets = stories.groupBy { column(it, taskExists) }
        return BoardColumn.entries.map { key ->
            val sorted = (buckets[key] ?: emptyList()).sortedWith(newerFirst)
            val capped = key == BoardColumn.Done || key == BoardColumn.Parked
            if (capped && sorted.size > CAP) BoardColumnData(key, sorted.take(CAP), sorted.size - CAP)
            else BoardColumnData(key, sorted)
        }
    }

    /**
     * View-only: In-progress cards whose task needs a person float to the head (stable order) and are counted. Parked
     * never floats: a blocked engine is often why a card was parked.
     */
    fun floatingAttention(columns: List<BoardColumnData>, needsYou: (String) -> Boolean): FloatedColumns {
        var count = 0
        val next = columns.map { col ->
            if (col.key != BoardColumn.InProgress) return@map col
            val hot = col.stories.filter { s -> s.link?.let(needsYou) ?: false }
            count = hot.size
            if (hot.isEmpty()) col else {
                val hotIds = hot.map { it.id }.toSet()
                col.copy(stories = hot + col.stories.filter { it.id !in hotIds })
            }
        }
        return FloatedColumns(next, count)
    }

    /** The same repo can arrive as `/tmp/x` and `/private/tmp/x`; compare on the resolved form. */
    fun repoKey(path: String): String {
        for (prefix in listOf("/private/tmp", "/private/var", "/private/etc")) {
            if (path == prefix || path.startsWith("$prefix/")) return path.removePrefix("/private")
        }
        return path
    }

    /** Board project tabs: repos with an issue record, saved projects and repos with a live task, once each. */
    fun projects(issueRepos: List<String>, knownRepos: List<String>): List<String> {
        val seen = mutableSetOf<String>()
        return (issueRepos + knownRepos).filter { seen.add(repoKey(it)) }
    }

    /** Title a started session carries, the shape the TUI and web board use. */
    fun sessionTitle(s: Story) = "#${s.id} ${s.title}"
}

/** Pure helpers for what the board prints. */
object BoardCardLogic {
    /** The first non-empty line of a description, trimmed; null when there is none. */
    fun firstLine(detail: String): String? = detail.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }

    /** In progress when it has cards, else backlog. */
    fun defaultColumn(columns: List<BoardColumnData>): BoardColumn =
        if (columns.firstOrNull { it.key == BoardColumn.InProgress }?.stories?.isNotEmpty() == true) BoardColumn.InProgress
        else BoardColumn.Backlog

    fun baseName(path: String) = path.trimEnd('/').substringAfterLast('/')

    /** Repo basenames; two projects sharing one are told apart by their parent folder. */
    fun projectLabels(paths: List<String>): Map<String, String> {
        val bases = paths.map(::baseName)
        val counts = bases.groupingBy { it }.eachCount()
        return paths.zip(bases).associate { (path, base) ->
            val parent = path.trimEnd('/').substringBeforeLast('/', "").substringAfterLast('/')
            path to if ((counts[base] ?: 0) > 1 && parent.isNotEmpty()) "$parent/$base" else base
        }
    }
}

/** What saving the title and description has to send; `clearBody` because the bridge refuses an empty `body`. */
data class StoryUpdate(val title: String?, val body: String?, val clearBody: Boolean)

/** The three editable fields of a story. Compared on trimmed text so a stray newline is not an edit. */
data class StoryEdit(val title: String, val body: String, val status: IssueStatus) {
    constructor(story: Story) : this(story.title, story.detail, story.status)

    fun titleChanged(o: StoryEdit) = title.trim() != o.title.trim()
    fun bodyChanged(o: StoryEdit) = body.trim() != o.body.trim()
    fun isDirty(o: StoryEdit) = titleChanged(o) || bodyChanged(o) || status != o.status

    /** A changed title must not be empty; an untouched one never blocks. */
    fun canSubmit(o: StoryEdit) = isDirty(o) && (!titleChanged(o) || title.trim().isNotEmpty())

    /** The `issue.update` payload for the title and description, null when neither changed. */
    fun update(o: StoryEdit): StoryUpdate? {
        if (!titleChanged(o) && !bodyChanged(o)) return null
        val text = body.trim()
        return StoryUpdate(
            title = if (titleChanged(o)) title.trim() else null,
            body = if (bodyChanged(o) && text.isNotEmpty()) text else null,
            clearBody = bodyChanged(o) && text.isEmpty(),
        )
    }
}

/** The EVENTS snapshot rows: `  3m  tool-start · Bash · claude`. */
object EventRowFormat {
    /** `TaskAge.label` of now minus the event, right-aligned to four characters. */
    fun age(at: Double, nowMs: Long): String =
        if (at <= 0) pad("—") else pad(TaskAge.label(maxOf(0.0, nowMs - at)))

    private fun pad(s: String) = s.padStart(4)
}

/** Where a story's session runs. */
enum class StartPlacement(val wire: String) {
    Worktree("worktree"), Project("project");

    companion object { fun of(raw: String) = entries.firstOrNull { it.wire == raw } ?: Worktree }
}

/** What the app does once the session started. */
enum class StartFollow(val wire: String) {
    Follow("follow"), Stay("stay");

    companion object { fun of(raw: String) = entries.firstOrNull { it.wire == raw } ?: Follow }
}

/** Best-effort steps that can fail after the session had already started. */
enum class StartStep { Link, MarkDoing }

data class StartWarning(val step: StartStep, val storyId: Int, val reason: String)

/** What a finished start hands back to the board. */
data class StartOutcome(
    val storyId: Int,
    /** The task to open on follow: the story's new task, or the project's main task. */
    val openTaskId: String,
    val follow: Boolean,
    val warnings: List<StartWarning>,
)
