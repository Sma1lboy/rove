package run.rove.mobile.domain

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// Wire models for Settings → Engines / Plugins and the task engine history (iOS `SettingsModels.swift`).
// Optional fields default so an older or newer bridge never fails a whole screen.

// MARK: Engines

@Serializable data class EngineSetting(
    val id: String,
    val name: String = "",
    val builtin: Boolean = false,
    val custom: Boolean = false,
    val enabled: Boolean = true,
    val isDefault: Boolean = false,
    val canBeDefault: Boolean = false,
    /** The launch program only; arguments never leave the Mac. */
    val binary: String? = null,
    val customized: Boolean = false,
    @SerialName("protocol") val protocolName: String? = null,
    val binaryFound: Boolean? = null,
    val binaryPath: String? = null,
    /** `yes`, `no` or `unknown` (no account detector for this engine). */
    val login: String = "unknown",
    /** `installed`, `outdated`, `not-installed` or `unsupported`. */
    val hooks: String = "unsupported",
    val markers: Boolean = false,
    val screen: Boolean = false,
    val configIssue: String? = null,
    /** The Rove agent skill: `installed`, `outdated`, `not-installed` or `unsupported`. */
    val skill: String = "unsupported",
) {
    val displayName get() = name.ifEmpty { id }
}

@Serializable data class EnginesSettingsPayload(val defaultId: String? = null, val engines: List<EngineSetting> = emptyList())

object EngineLogic {
    /** What the bridge would refuse, said before the tap: the last enabled engine stays on. */
    fun canDisable(engine: EngineSetting, all: List<EngineSetting>) = all.any { it.id != engine.id && it.enabled }

    /** Web Settings › Engines › Engine integrations: an engine whose CLI is not on the Mac has nothing to install into. */
    fun hooks(all: List<EngineSetting>): InstallCount {
        val hooked = all.filter { it.hooks != "unsupported" }
        val hookable = hooked.filter { it.binaryFound != false }
        return InstallCount(hookable.count { it.hooks == "installed" }, hookable.size, hooked.count { it.hooks != "not-installed" }, hooked.isNotEmpty())
    }

    /** Web Settings › Engines › Rove agent skill. */
    fun skill(all: List<EngineSetting>): InstallCount {
        val able = all.filter { it.skill != "unsupported" }
        return InstallCount(able.count { it.skill == "installed" }, able.size, 0, true)
    }
}

/** [onDisk]: engines with any Rove hook to remove. [shown]: the section applies on this Mac at all. */
data class InstallCount(val installed: Int, val total: Int, val onDisk: Int, val shown: Boolean) {
    val missing get() = total - installed
}

// MARK: Plugins

@Serializable data class PluginDeclares(val actions: Int = 0, val events: Int = 0, val panes: Int = 0, val engines: Int = 0)

@Serializable data class PluginLastRun(
    /** Epoch ms. */
    val at: Double = 0.0,
    val label: String = "run",
    val ok: Boolean = false,
    val running: Boolean = false,
)

@Serializable data class PluginInfo(
    val id: String,
    val version: String = "",
    val enabled: Boolean = false,
    val linked: Boolean = false,
    val platformOk: Boolean = true,
    val hooksDeclared: Boolean = false,
    val updateAvailable: Boolean = false,
    val declares: PluginDeclares? = null,
    val lastRun: PluginLastRun? = null,
)

@Serializable data class PluginsPayload(val plugins: List<PluginInfo> = emptyList())

// MARK: Engine history (`output.read`)

/** Tool input and output are a string for some engines and a list of `{type, text}` parts for others. */
object FlatTextSerializer : KSerializer<String?> {
    override val descriptor = String.serializer().nullable.descriptor
    override fun deserialize(decoder: Decoder): String? = flatten((decoder as JsonDecoder).decodeJsonElement())
    override fun serialize(encoder: Encoder, value: String?) = if (value == null) encoder.encodeNull() else encoder.encodeString(value)

    fun flatten(element: kotlinx.serialization.json.JsonElement): String? = when (element) {
        is JsonPrimitive -> if (element.isString) element.contentOrNull else null
        is JsonArray -> element.mapNotNull { ((it as? JsonObject)?.get("text") as? JsonPrimitive)?.contentOrNull }
            .joinToString("\n").ifEmpty { null }
        else -> null
    }
}

@Serializable data class OutputBlock(
    /** `text`, `tool_call`, `tool_result`, or an engine-specific type the app shows verbatim. */
    val type: String = "text",
    val text: String? = null,
    val name: String? = null,
    @Serializable(with = FlatTextSerializer::class) val input: String? = null,
    @Serializable(with = FlatTextSerializer::class) val output: String? = null,
)

@Serializable data class OutputMessage(
    val role: String = "assistant",
    val blocks: List<OutputBlock> = emptyList(),
    val timestamp: String? = null,
)

@Serializable data class OutputHistory(
    val messages: List<OutputMessage> = emptyList(),
    val totalMessages: Int? = null,
    val limited: Boolean = false,
)

/** `rove api read-output` sends the tail as screen rows; joined here, so a bridge that sent one string still decodes. */
object TailLinesSerializer : KSerializer<String> {
    override val descriptor = String.serializer().descriptor
    override fun deserialize(decoder: Decoder): String = when (val e = (decoder as JsonDecoder).decodeJsonElement()) {
        is JsonArray -> e.joinToString("\n") { (it as? JsonPrimitive)?.contentOrNull.orEmpty() }
        is JsonPrimitive -> e.contentOrNull.orEmpty()
        else -> ""
    }
    override fun serialize(encoder: Encoder, value: String) = encoder.encodeString(value)
}

@Serializable data class OutputTerminal(@Serializable(with = TailLinesSerializer::class) val tail: String = "",
                                        val truncated: Boolean = false, val live: Boolean = false)

@Serializable data class OutputEnvelope(
    val vendor: String? = null,
    val running: Boolean = false,
    /** `history` (the engine's own transcript) or `terminal` (a labeled tail). */
    val source: String = "terminal",
    val history: OutputHistory? = null,
    val terminal: OutputTerminal? = null,
    val cursor: String? = null,
    /** Why the read fell back to the terminal tail, when it did. */
    val fallbackReason: String? = null,
    val warnings: List<String> = emptyList(),
)
