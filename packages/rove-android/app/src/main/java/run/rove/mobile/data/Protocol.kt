package run.rove.mobile.data

import kotlinx.serialization.json.*

val wireJson = Json { ignoreUnknownKeys = true }
fun args(vararg pairs: Pair<String, Any>): JsonObject = buildJsonObject {
    pairs.forEach { (key, value) -> put(key, when (value) {
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        else -> JsonPrimitive(value.toString())
    }) }
}
class BridgeFailure(val code: String, message: String) : Exception(message)
sealed interface Frame {
    data class Reply(val id: Long, val result: JsonObject?, val failure: BridgeFailure?) : Frame
    data class Event(val name: String, val data: JsonObject) : Frame
}
object Protocol {
    fun request(id: Long, op: String, args: JsonObject) = buildJsonObject {
        put("id", id); put("op", op); put("args", args)
    }.toString()
    fun parse(raw: String): Frame? {
        val obj = wireJson.parseToJsonElement(raw).jsonObject
        val event = obj["event"]?.jsonPrimitive?.content
        if (event != null) return Frame.Event(event, obj["data"]?.jsonObject ?: JsonObject(emptyMap()))
        val id = obj["id"]?.jsonPrimitive?.longOrNull ?: return null
        return if (obj["ok"]?.jsonPrimitive?.booleanOrNull == true) {
            Frame.Reply(id, obj["result"]?.jsonObject ?: JsonObject(emptyMap()), null)
        } else {
            val error = obj["error"]?.jsonObject
            Frame.Reply(id, null, BridgeFailure(error?.get("code")?.jsonPrimitive?.content ?: "FAILED",
                error?.get("message")?.jsonPrimitive?.content ?: "Bridge refused the request"))
        }
    }
}
