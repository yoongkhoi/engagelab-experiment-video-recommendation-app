package com.example.engagevideopush.playback

/**
 * Decides when a video must be prepared. Play, pause, seek, and speed changes
 * never request another prepare. A new video id, or an explicit retry after an
 * error, does.
 */
class PlaybackSession {
    var videoId: String? = null
        private set
    var positionMs: Long = 0
        private set
    var durationMs: Long = 0
        private set
    var playing: Boolean = false
        private set
    var speed: Float = 1f
        private set
    var buffering: Boolean = false
        private set
    var error: String? = null
        private set
    var ended: Boolean = false
        private set
    var prepareCount: Int = 0
        private set
    var playerCreations: Int = 0
        private set

    fun attachPlayer() {
        playerCreations += 1
    }

    /** Returns true only when ExoPlayer must load this media. */
    fun open(videoId: String): Boolean {
        if (this.videoId == videoId && error == null) return false
        val changed = this.videoId != videoId
        this.videoId = videoId
        if (changed) {
            positionMs = 0
            speed = 1f
            ended = false
        }
        error = null
        buffering = true
        playing = true
        prepareCount += 1
        return true
    }

    fun play() {
        if (videoId == null || error != null) return
        if (ended) {
            positionMs = 0
            ended = false
        }
        playing = true
    }

    fun pause() {
        if (videoId == null) return
        playing = false
    }

    fun setSpeed(speed: Float) {
        if (videoId == null) return
        this.speed = speed
    }

    fun onDuration(durationMs: Long) {
        if (durationMs > 0) this.durationMs = durationMs
    }

    fun onPosition(positionMs: Long) {
        this.positionMs = positionMs.coerceAtLeast(0)
    }

    fun seekBy(deltaMs: Long) {
        if (videoId == null) return
        val cap = if (durationMs > 0) durationMs else Long.MAX_VALUE
        positionMs = (positionMs + deltaMs).coerceIn(0, cap)
        if (durationMs > 0 && positionMs >= durationMs) {
            ended = true
            playing = false
        } else {
            ended = false
        }
    }

    fun markBuffering(buffering: Boolean) {
        this.buffering = buffering
    }

    fun onPlayingChanged(isPlaying: Boolean) {
        if (error != null) return
        playing = isPlaying
        if (isPlaying) ended = false
    }

    fun markEnded() {
        ended = true
        playing = false
        buffering = false
        if (durationMs > 0) positionMs = durationMs
    }

    fun fail(message: String) {
        error = message
        playing = false
        buffering = false
    }

    /** Prepare the same media again after a failure. Does not change the video id. */
    fun retry(): Boolean {
        if (videoId == null || error == null) return false
        error = null
        buffering = true
        prepareCount += 1
        return true
    }

    fun neighbor(ids: List<String>, delta: Int): String? {
        val index = ids.indexOf(videoId)
        if (index < 0) return null
        return ids.getOrNull(index + delta)
    }

    fun snapshot(): PlaybackSnapshot = PlaybackSnapshot(
        videoId = videoId,
        playing = playing,
        speed = speed,
        positionMs = positionMs,
        durationMs = durationMs,
        buffering = buffering,
        error = error,
        ended = ended,
    )
}

data class PlaybackSnapshot(
    val videoId: String?,
    val playing: Boolean,
    val speed: Float,
    val positionMs: Long,
    val durationMs: Long,
    val buffering: Boolean,
    val error: String?,
    val ended: Boolean,
)

fun formatPlaybackTime(positionMs: Long): String {
    val safe = positionMs.coerceAtLeast(0) / 1000
    return "%d:%02d".format(safe / 60, safe % 60)
}
