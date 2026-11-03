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

data class AuthSession(val token: String, val expiresAt: String, val email: String)

data class RegistrationResult(
    val deviceToken: String,
    val tagSyncStatus: String,
    val note: String,
)

object LocalCatalog {
    val videos = emptyList<VideoItem>()
}
