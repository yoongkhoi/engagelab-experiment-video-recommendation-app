package com.example.engagevideopush.data

import org.json.JSONObject

object VideoJson {
    fun parse(json: JSONObject): VideoItem? {
        val id = json.optString("video_id").ifBlank { json.optString("id") }
        val source = json.optString("video_url").ifBlank { json.optString("source") }
        if (id.isBlank() || source.isBlank()) return null
        val thumbnail = json.optString("thumbnail_url").ifBlank { json.optString("thumbnailUrl") }.ifBlank { null }
        val duration = if (json.has("duration") && !json.isNull("duration")) json.optInt("duration") else null
        return VideoItem(
            id = id,
            title = json.optString("title").ifBlank { "Video $id" },
            description = json.optString("description"),
            category = json.optString("category").ifBlank { "video" },
            sourceType = json.optString("sourceType", "remote"),
            source = source,
            assetFilename = json.optString("assetFilename").ifBlank { null },
            thumbnailUrl = thumbnail,
            active = json.optBoolean("active", true),
            durationSeconds = duration,
            creatorName = json.optString("creator_name").ifBlank { null },
            creatorProfileUrl = httpsOrNull(json.optString("creator_profile_url")),
            sourceUrl = httpsOrNull(json.optString("source_url")),
        )
    }

    fun parseList(body: JSONObject): List<VideoItem> {
        val array = body.optJSONArray("videos") ?: return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val video = parse(array.getJSONObject(index))
                if (video != null && video.active) add(video)
            }
        }
    }

    private fun httpsOrNull(value: String): String? {
        return value.takeIf { it.startsWith("https://") }
    }
}
