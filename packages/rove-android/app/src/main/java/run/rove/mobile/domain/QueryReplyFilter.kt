package run.rove.mobile.domain

/**
 * xterm.js answers terminal queries through `onData`, as if typed. The PTY host / attached TUI already
 * answers them, so DA1/DA2, DECRQM and OSC 10/11/4 colour replies are dropped; everything else (including
 * cursor position reports) goes through. iOS `QueryReplyFilter`.
 */
object QueryReplyFilter {
    private val replies = Regex(
        "\u001b\\[[?>][0-9;]*c" +                        // DA1 / DA2
            "|\u001b\\[\\??[0-9;]*\\\$y" +               // DECRQM
            "|\u001b\\](?:10|11|4);[^\u0007\u001b]*(?:\u0007|\u001b\\\\)") // OSC colour replies

    fun filter(typed: String): String = if ('\u001b' in typed) typed.replace(replies, "") else typed
}
