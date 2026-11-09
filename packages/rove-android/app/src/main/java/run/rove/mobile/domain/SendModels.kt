package run.rove.mobile.domain

import kotlinx.serialization.Serializable

/** `tab.send`'s answer: the engine took it, or the reason it did not. */
@Serializable data class SendReply(val delivered: Boolean = false, val reason: String? = null)
