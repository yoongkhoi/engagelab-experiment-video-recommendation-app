package com.example.engagevideopush.data

import android.content.Context

class VideoRepository(private val context: Context, private val api: BackendApi) {
    fun loadFeed(category: FeedCategories.Item = FeedCategories.all.first(), page: Int = 1): FeedResult {
        return try {
            val body = api.getFeed(FeedCategories.path(category, page))
            val remote = VideoJson.parseList(body)
            val total = if (body.has("totalResults") && !body.isNull("totalResults")) body.optInt("totalResults") else null
            val attribution = body.optJSONObject("attribution")?.optString("url")?.takeIf { it.startsWith("https://") }
            if (remote.isEmpty()) {
                FeedResult(emptyList(), offline = false, message = "No videos for ${category.label}.", page = page, totalResults = total, attributionUrl = attribution)
            } else {
                FeedResult(remote, offline = false, message = null, page = page, totalResults = total, attributionUrl = attribution)
            }
        } catch (error: Exception) {
            FeedResult(
                LocalCatalog.videos,
                offline = true,
                message = error.message ?: "Recommendations are unavailable. Showing the bundled catalogue.",
                page = 1,
                totalResults = null,
                attributionUrl = null,
            )
        }
    }

    fun resolve(videoId: String): VideoItem? {
        val remote = try {
            api.getVideo(videoId)
        } catch (_: Exception) {
            null
        }
        return remote ?: LocalCatalog.videos.find { it.id == videoId }
    }

    fun playbackUri(video: VideoItem): String? {
        val asset = video.assetFilename
        if (!asset.isNullOrBlank() && assetExists(asset)) return "asset:///videos/$asset"
        if (video.source.startsWith("https://")) return video.source
        return null
    }

    private fun assetExists(filename: String): Boolean {
        return try {
            context.assets.open("videos/$filename").close()
            true
        } catch (_: Exception) {
            false
        }
    }
}

data class FeedResult(
    val videos: List<VideoItem>,
    val offline: Boolean,
    val message: String?,
    val page: Int = 1,
    val totalResults: Int? = null,
    val attributionUrl: String? = null,
)
