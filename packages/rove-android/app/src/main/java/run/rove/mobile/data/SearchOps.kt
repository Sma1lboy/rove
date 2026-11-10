package run.rove.mobile.data

import kotlinx.serialization.json.decodeFromJsonElement
import run.rove.mobile.domain.SearchReply

suspend fun RoveRepository.searchSessions(query: String): SearchReply =
    wireJson.decodeFromJsonElement(bridge.request("sessions.search", args("query" to query)))
