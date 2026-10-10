package run.rove.mobile.data

import kotlinx.serialization.json.*
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64

class DemoFixture(raw: String, private val now: () -> Instant = Instant::now) {
    private val ops = wireJson.parseToJsonElement(raw).jsonObject
    fun answer(op: String, args: JsonObject = JsonObject(emptyMap())): JsonObject {
        var entry = ops[op] ?: JsonObject(emptyMap())
        (entry as? JsonObject)?.get("\$same_as")?.jsonPrimitive?.content?.let {
            entry = ops[it] ?: JsonObject(emptyMap())
        }
        val table = entry as? JsonObject
        table?.get("\$by")?.let { by ->
            val fields = if (by is JsonArray) by.map { it.jsonPrimitive.content } else listOf(by.jsonPrimitive.content)
            val key = fields.joinToString(":") { args[it]?.jsonPrimitive?.content ?: "" }
            entry = table[key] ?: table["*"] ?: JsonObject(emptyMap())
        }
        return resolve(entry, now()).jsonObject
    }
    // One `now` per answer at whole seconds, like iOS: equal `$ago_min` values must tie so the id tiebreak decides.
    private fun resolve(value: JsonElement, now: Instant): JsonElement = when (value) {
        is JsonArray -> JsonArray(value.map { resolve(it, now) })
        is JsonObject -> when {
            "\$b64" in value -> JsonPrimitive(Base64.getEncoder().encodeToString(value.getValue("\$b64").jsonPrimitive.content.toByteArray()))
            "\$ago_min" in value || "\$in_min" in value -> {
                val ago = value["\$ago_min"]?.jsonPrimitive?.double
                val minutes = ago ?: value.getValue("\$in_min").jsonPrimitive.double
                val time = now.plusMillis((minutes * 60_000 * if (ago == null) 1 else -1).toLong())
                if (value["\$as"]?.jsonPrimitive?.content == "ms") JsonPrimitive(time.toEpochMilli())
                else JsonPrimitive(time.truncatedTo(ChronoUnit.SECONDS).toString())
            }
            else -> JsonObject(value.mapValues { resolve(it.value, now) })
        }
        else -> value
    }
}
