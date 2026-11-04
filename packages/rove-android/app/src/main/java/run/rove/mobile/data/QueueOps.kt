package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.HeldPrompt
import run.rove.mobile.domain.HeldPrompts
import run.rove.mobile.domain.SendReply

/** Pastes and submits on an idle tab; a busy tab holds the message until its turn ends. */
suspend fun RoveRepository.sendMessage(taskId: String, tabId: String, prompt: String): SendReply = wireJson.decodeFromJsonElement(
    bridge.request("tab.send", args("taskId" to taskId, "tabId" to tabId, "prompt" to prompt, "queue" to true)))

suspend fun RoveRepository.heldPrompts(taskId: String): List<HeldPrompt> =
    wireJson.decodeFromJsonElement<HeldPrompts>(bridge.request("queue.list", args("taskId" to taskId))).items

suspend fun RoveRepository.cancelHeld(id: String) { bridge.request("queue.cancel", args("id" to id)) }
