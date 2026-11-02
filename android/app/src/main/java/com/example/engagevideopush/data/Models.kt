package com.example.engagevideopush.data

data class VideoItem(
    val id: String,
    val title: String,
    val description: String,
    val category: String,
    val sourceType: String,
    val source: String,
    val assetFilename: String?,
    val thumbnailUrl: String?,
    val active: Boolean,
    val durationSeconds: Int? = null,
    val creatorName: String? = null,
    val creatorProfileUrl: String? = null,
    val sourceUrl: String? = null,
)

data class RegistrationResult(
    val deviceToken: String,
    val tagSyncStatus: String,
    val note: String,
)

object LocalCatalog {
    val videos = listOf(
        VideoItem(
            id = "1001",
            title = "Signal Path",
            description = "Technology sample. Uses tech.mp4 when it is bundled, otherwise the Big Buck Bunny sample.",
            category = "tech",
            sourceType = "remote",
            source = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            assetFilename = "tech.mp4",
            thumbnailUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg",
            active = true,
        ),
        VideoItem(
            id = "1002",
            title = "Cut to the Punchline",
            description = "Funny sample. Uses funny.mp4 when it is bundled, otherwise Elephants Dream.",
            category = "funny",
            sourceType = "remote",
            source = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
            assetFilename = "funny.mp4",
            thumbnailUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg",
            active = true,
        ),
        VideoItem(
            id = "1003",
            title = "Weekend Drift",
            description = "Lifestyle sample. Uses lifestyle.mp4 when it is bundled, otherwise a short developer sample.",
            category = "lifestyle",
            sourceType = "remote",
            source = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
            assetFilename = "lifestyle.mp4",
            thumbnailUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyrides.jpg",
            active = true,
        ),
    )
}
