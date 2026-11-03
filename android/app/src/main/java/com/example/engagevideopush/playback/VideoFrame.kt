package com.example.engagevideopush.playback

/** Width divided by height. A portrait clip is below 1. Unknown size uses 16:9. */
fun playerAspectRatio(videoWidth: Int, videoHeight: Int): Float {
    if (videoWidth <= 0 || videoHeight <= 0) return 16f / 9f
    return videoWidth.toFloat() / videoHeight.toFloat()
}
