package run.rove.mobile.domain

/** The bundled `docs/PRIVACY.md` as plain text: settings → about shows it without a Markdown renderer. */
object PolicyText {
    private val heading = Regex("^#{1,6}\\s+")
    private val link = Regex("\\[([^\\]]+)]\\(([^)]+)\\)")
    private val autolink = Regex("<(https?://[^>]+)>")
    private val emphasis = Regex("\\*\\*([^*]+)\\*\\*")
    private val code = Regex("`([^`]+)`")

    fun plain(markdown: String): String = markdown.lines().joinToString("\n") { line ->
        line.replace(heading, "")
            .replace(link, "$1 ($2)")
            .replace(autolink, "$1")
            .replace(emphasis, "$1")
            .replace(code, "$1")
    }.trim()
}
