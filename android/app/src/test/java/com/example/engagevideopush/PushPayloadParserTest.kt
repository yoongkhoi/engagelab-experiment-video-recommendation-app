package com.example.engagevideopush

import com.example.engagevideopush.data.LocalCatalog
import com.example.engagevideopush.push.NotificationOpenDeduper
import com.example.engagevideopush.push.PushPayloadParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PushPayloadParserTest {
    @Test
    fun readsNestedEngageLabExtras() {
        val json = """
            {"msg_id":"1828","n_title":"Watch","n_extras":{"video_id":"1001","campaign_id":"abc","category":"tech"}}
        """.trimIndent()
        val parsed = PushPayloadParser.parse(json)
        assertEquals("1001", parsed.videoId)
        assertEquals("abc", parsed.campaignId)
        assertEquals("tech", parsed.category)
        assertTrue(parsed.valid)
    }

    @Test
    fun prefersIntentExtrasAndRejectsAMissingVideo() {
        val parsed = PushPayloadParser.parse("""{"extras":{}}""", mapOf("campaign_id" to "abc"))
        assertFalse(parsed.valid)
        assertEquals(null, parsed.videoId)
    }

    @Test
    fun rejectsAnUnsafeVideoId() {
        val parsed = PushPayloadParser.parse(null, mapOf("video_id" to "bad id"))
        assertFalse(parsed.valid)
    }

    @Test
    fun ignoresARepeatedNotificationWithinTheWindow() {
        NotificationOpenDeduper.reset()
        assertTrue(NotificationOpenDeduper.shouldHandle("open:1", now = 1_000))
        assertFalse(NotificationOpenDeduper.shouldHandle("open:1", now = 2_000))
        assertTrue(NotificationOpenDeduper.shouldHandle("open:1", now = 8_000))
    }

    @Test
    fun readsDirectExtras() {
        val parsed = PushPayloadParser.parse(
            null,
            mapOf("video_id" to "1001", "campaign_id" to "abc", "category" to "tech"),
        )
        assertEquals("1001", parsed.videoId)
        assertEquals("abc", parsed.campaignId)
        assertEquals("tech", parsed.category)
        assertEquals("player/1001?campaignId=abc&category=tech", PushPayloadParser.routeFor(parsed))
    }

    @Test
    fun readsDocumentedMessageJsonAndMatchesTheExtrasDedupeKey() {
        val json = """{"msg_id":"1828","extras":{"video_id":"1001","campaign_id":"abc","category":"tech"}}"""
        val fromJson = PushPayloadParser.fromIntentFields(null, json, emptyMap(), null)
        val fromExtras = PushPayloadParser.fromIntentFields(
            PushPayloadParser.ACTION_OPEN,
            null,
            mapOf("video_id" to "1001", "campaign_id" to "abc", "category" to "tech"),
            "1828",
        )
        assertEquals("1001", fromJson?.videoId)
        assertEquals(fromJson?.dedupeKey, fromExtras?.dedupeKey)
        NotificationOpenDeduper.reset()
        assertTrue(NotificationOpenDeduper.shouldHandle(fromJson!!.dedupeKey, now = 1_000))
        assertFalse(NotificationOpenDeduper.shouldHandle(fromExtras!!.dedupeKey, now = 2_000))
    }

    @Test
    fun malformedJsonDoesNotDiscardDirectExtras() {
        val parsed = PushPayloadParser.parse("{not-json", mapOf("video_id" to "1001"))
        assertEquals("1001", parsed.videoId)
        assertTrue(parsed.valid)
    }

    @Test
    fun missingPayloadOnALauncherIntentDoesNotNavigate() {
        val coldStart = PushPayloadParser.fromIntentFields("android.intent.action.MAIN", null, emptyMap(), null)
        assertNull(coldStart)
    }

    @Test
    fun actionOpenWithoutAVideoRoutesToTheMissingScreen() {
        val opened = PushPayloadParser.fromIntentFields(PushPayloadParser.ACTION_OPEN, null, emptyMap(), null)
        assertEquals("missing", PushPayloadParser.routeFor(opened!!))
    }

    @Test
    fun aPixabayVideoIdRoutesToThatPlayerOnce() {
        NotificationOpenDeduper.reset()
        val parsed = PushPayloadParser.parse(null, mapOf("video_id" to "125", "campaign_id" to "camp", "category" to "nature"))
        assertTrue(parsed.valid)
        assertEquals("player/125?campaignId=camp&category=nature", PushPayloadParser.routeFor(parsed))
        assertTrue(NotificationOpenDeduper.shouldHandle(parsed.dedupeKey, now = 1_000))
        assertFalse(NotificationOpenDeduper.shouldHandle(parsed.dedupeKey, now = 2_000))
    }

    @Test
    fun anUnknownWellFormedVideoIdIsNotInTheLocalCatalogue() {
        val parsed = PushPayloadParser.parse(null, mapOf("video_id" to "9999", "category" to "tech"))
        assertTrue(parsed.valid)
        assertEquals("player/9999?campaignId=&category=tech", PushPayloadParser.routeFor(parsed))
        assertNull(LocalCatalog.videos.find { it.id == "9999" })
        assertNull(LocalCatalog.videos.find { it.id == "1001" })
    }
}
