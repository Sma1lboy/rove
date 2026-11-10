package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.SendReply

/** Pastes and submits through the engine's own input; a busy engine queues or steers it itself, and Rove holds nothing. */
suspend fun RoveRepository.sendMessage(taskId: String, tabId: String, prompt: String): SendReply = wireJson.decodeFromJsonElement(
    bridge.request("tab.send", args("taskId" to taskId, "tabId" to tabId, "prompt" to prompt)))
