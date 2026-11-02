package com.example.engagevideopush.push

import org.json.JSONArray
import org.json.JSONObject

data class ParsedPush(
    val videoId: String?,
    val campaignId: String?,
    val category: String?,
    val messageId: String?,
    val valid: Boolean,
    val dedupeKey: String,
)

object PushPayloadParser {
    private val videoIdPattern = Regex("^[A-Za-z0-9_\\-]{1,64}$")

    fun parse(
        messageJson: String?,
        extras: Map<String, String?> = emptyMap(),
        messageId: String? = null,
    ): ParsedPush {
        val found = linkedMapOf<String, String>()
        extras.forEach { (key, value) ->
            if (!value.isNullOrBlank()) found[key] = value
        }
        if (!messageJson.isNullOrBlank()) {
            try {
                collect(JSONObject(messageJson), found)
            } catch (_: Exception) {
                // Malformed provider JSON still allows intent extras collected above.
            }
        }
        val rawVideoId = found["video_id"]
        val videoId = rawVideoId?.takeIf { videoIdPattern.matches(it) }
        val campaignId = found["campaign_id"]
        val category = found["category"]
        val resolvedMessageId = messageId?.takeIf { it.isNotBlank() }
            ?: found["msg_id"]
            ?: found["messageId"]
        // Message id is kept for logs. The dedupe key omits it so an SDK intent
        // that has message_json and a receiver intent that only has extras collapse
        // into one navigation when they name the same video and campaign.
        val dedupe = "${videoId ?: rawVideoId ?: "missing"}:${campaignId ?: ""}"
        return ParsedPush(
            videoId = videoId,
            campaignId = campaignId,
            category = category,
            messageId = resolvedMessageId,
            valid = videoId != null,
            dedupeKey = "open:$dedupe",
        )
    }

    fun routeFor(parsed: ParsedPush): String {
        if (!parsed.valid || parsed.videoId == null) return "missing"
        val campaign = parsed.campaignId ?: ""
        val category = parsed.category ?: ""
        return "player/${parsed.videoId}?campaignId=$campaign&category=$category"
    }

    /**
     * Shared by cold start (onCreate) and a later delivery (onNewIntent).
     * A launcher intent with no push fields returns null and does not navigate.
     */
    fun fromIntentFields(
        action: String?,
        messageJson: String?,
        extras: Map<String, String?>,
        messageId: String?,
    ): ParsedPush? {
        val hasPayload = !messageJson.isNullOrBlank() || extras.values.any { !it.isNullOrBlank() }
        if (!hasPayload && action != ACTION_OPEN) return null
        return parse(messageJson, extras, messageId)
    }

    const val ACTION_OPEN = "com.example.engagevideopush.ACTION_OPEN"

    private fun collect(value: Any?, into: MutableMap<String, String>) {
        when (value) {
            is JSONObject -> {
                val keys = value.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val child = value.opt(key)
                    if (child is JSONObject || child is JSONArray) {
                        collect(child, into)
                    } else if (child != null && child != JSONObject.NULL && !into.containsKey(key)) {
                        into[key] = child.toString()
                    }
                }
            }
            is JSONArray -> {
                for (index in 0 until value.length()) collect(value.opt(index), into)
            }
        }
    }
}
