package run.rove.mobile.domain

import kotlinx.serialization.Serializable

/** `tab.send`'s answer: pasted now, or held by the daemon until the running turn ends. */
@Serializable data class SendReply(val delivered: Boolean = false, val queued: Boolean = false, val position: Int? = null, val reason: String? = null)
@Serializable data class HeldPrompt(val id: String, val tabId: String = "", val text: String = "")
@Serializable data class HeldPrompts(val items: List<HeldPrompt> = emptyList())

sealed interface SendOutcome {
    data object Delivered : SendOutcome
    data class Queued(val position: Int) : SendOutcome
    data class NotSent(val reason: String) : SendOutcome
}

object QueueLogic {
    private const val HEAD_CHARS = 32

    fun outcome(reply: SendReply): SendOutcome = when {
        reply.queued -> SendOutcome.Queued(reply.position ?: 1)
        reply.delivered -> SendOutcome.Delivered
        else -> SendOutcome.NotSent(reply.reason.orEmpty())
    }

    fun held(items: List<HeldPrompt>, tabId: String) = items.filter { it.tabId == tabId }

    fun head(text: String) = if (text.length > HEAD_CHARS) text.take(HEAD_CHARS) + "…" else text
}
