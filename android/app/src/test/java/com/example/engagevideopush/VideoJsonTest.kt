package com.example.engagevideopush

import com.example.engagevideopush.data.FeedCategories
import com.example.engagevideopush.data.VideoItem
import com.example.engagevideopush.data.VideoJson
import com.example.engagevideopush.data.resolvePlayback
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VideoJsonTest {
    @Test
    fun readsAPixabayVideoAndIgnoresANonHttpsProfile() {
        val parsed = VideoJson.parse(JSONObject("""
            {
              "video_id": "125",
              "title": "flowers, yellow",
              "description": "Video by Coverr-Free-Footage on Pixabay. 12s.",
              "category": "nature",
              "source": "https://cdn.pixabay.com/video/125_medium.mp4",
              "video_url": "https://cdn.pixabay.com/video/125_medium.mp4",
              "thumbnail_url": "https://cdn.pixabay.com/video/125_medium.jpg",
              "duration": 12,
              "creator_name": "Coverr-Free-Footage",
              "creator_profile_url": "http://pixabay.com/users/nope",
              "source_url": "https://pixabay.com/videos/id-125/"
            }
        """.trimIndent()))
        assertEquals("125", parsed?.id)
        assertEquals("https://cdn.pixabay.com/video/125_medium.mp4", parsed?.source)
        assertEquals(12, parsed?.durationSeconds)
        assertEquals("Coverr-Free-Footage", parsed?.creatorName)
        assertNull(parsed?.creatorProfileUrl)
        assertEquals("https://pixabay.com/videos/id-125/", parsed?.sourceUrl)
    }

    @Test
    fun skipsAVideoWithoutAnIdOrSource() {
        assertNull(VideoJson.parse(JSONObject("""{"title":"missing"}""")))
    }

    @Test
    fun uploadedFilePlaysFromTheConfiguredBackend() {
        val video = VideoItem(
            id = "local",
            title = "Chosen clip",
            description = "Selected from the operator computer.",
            category = "tech",
            sourceType = "remote",
            source = "/media/0123456789abcdef.mp4",
            assetFilename = null,
            thumbnailUrl = null,
            active = true,
        )
        assertEquals(
            "http://192.168.1.8:3000/media/0123456789abcdef.mp4",
            resolvePlayback(video, "http://192.168.1.8:3000/", { false }),
        )
        assertNull(resolvePlayback(video.copy(source = "/media/../secret.mp4"), "http://192.168.1.8:3000", { false }))
    }

    @Test
    fun categoryPathsStayOnTheBackend() {
        assertEquals("/api/videos/popular?page=1", FeedCategories.path(FeedCategories.all.first(), 1))
        val nature = FeedCategories.all.first { it.label == "Nature" }
        assertEquals("/api/videos?query=nature&page=2", FeedCategories.path(nature, 2))
    }
}
