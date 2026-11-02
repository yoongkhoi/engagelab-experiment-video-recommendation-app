package com.example.engagevideopush

import com.example.engagevideopush.playback.PlaybackSession
import com.example.engagevideopush.playback.formatPlaybackTime
import com.example.engagevideopush.push.PushPayloadParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackSessionTest {
    @Test
    fun playAndPauseKeepTheSameMediaAndPosition() {
        val session = PlaybackSession()
        session.attachPlayer()
        assertTrue(session.open("228847"))
        session.onDuration(20_000)
        session.onPosition(4_000)
        session.pause()
        session.play()
        assertEquals("228847", session.videoId)
        assertEquals(4_000, session.positionMs)
        assertTrue(session.playing)
        assertEquals(1, session.prepareCount)
        assertEquals(1, session.playerCreations)
        assertFalse(session.open("228847"))
        assertEquals(1, session.prepareCount)
    }

    @Test
    fun rewindAndFastForwardMoveTenSecondsWithoutPreparing() {
        val session = PlaybackSession()
        session.open("125")
        session.onDuration(60_000)
        session.onPosition(15_000)
        session.seekBy(-10_000)
        assertEquals(5_000, session.positionMs)
        session.seekBy(10_000)
        assertEquals(15_000, session.positionMs)
        session.seekBy(-60_000)
        assertEquals(0, session.positionMs)
        assertEquals(1, session.prepareCount)
    }

    @Test
    fun speedChangesDoNotPrepareOrChangeVideo() {
        val session = PlaybackSession()
        session.open("125")
        session.onPosition(3_000)
        session.setSpeed(0.5f)
        assertEquals(0.5f, session.speed)
        session.pause()
        session.play()
        session.setSpeed(1f)
        assertEquals(1f, session.speed)
        assertEquals("125", session.videoId)
        assertEquals(3_000, session.positionMs)
        assertEquals(1, session.prepareCount)
    }

    @Test
    fun nextAndPreviousFollowTheFeedWithoutASecondPlayer() {
        val session = PlaybackSession()
        session.attachPlayer()
        session.open("b")
        val ids = listOf("a", "b", "c")
        assertEquals("c", session.neighbor(ids, 1))
        assertEquals("a", session.neighbor(ids, -1))
        assertTrue(session.open("c"))
        assertNull(session.neighbor(ids, 1))
        assertEquals(2, session.prepareCount)
        assertEquals(1, session.playerCreations)
        assertNull(session.neighbor(listOf("z"), 1))
    }

    @Test
    fun resumingDoesNotPrepareButRetryAfterAnErrorDoes() {
        val session = PlaybackSession()
        session.open("228847")
        session.onPosition(8_000)
        session.pause()
        session.play()
        assertEquals(1, session.prepareCount)
        session.fail("Network lost")
        assertFalse(session.playing)
        assertTrue(session.retry())
        assertNull(session.error)
        assertEquals(2, session.prepareCount)
        assertEquals("228847", session.videoId)
        assertEquals(8_000, session.positionMs)
        session.play()
        assertEquals(2, session.prepareCount)
    }

    @Test
    fun notificationRouteStaysOnTheSameVideoWhileControllingPlayback() {
        val session = PlaybackSession()
        session.open("228847")
        session.pause()
        session.play()
        session.setSpeed(0.5f)
        session.seekBy(10_000)
        val parsed = PushPayloadParser.parse(null, mapOf("video_id" to session.videoId, "campaign_id" to "camp", "category" to "nature"))
        assertTrue(parsed.valid)
        assertEquals("player/228847?campaignId=camp&category=nature", PushPayloadParser.routeFor(parsed))
        assertEquals("0:10", formatPlaybackTime(session.positionMs))
    }
}
