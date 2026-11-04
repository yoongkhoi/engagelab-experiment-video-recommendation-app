package com.example.engagevideopush

import com.example.engagevideopush.data.BackendException
import com.example.engagevideopush.data.usableGuestKey
import com.example.engagevideopush.ui.chatFailureMessage
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatFailureMessageTest {
    @Test
    fun hidesValidationAndTracebackDetails() {
        assertEquals(
            "That message could not be sent. Try describing the videos you want.",
            chatFailureMessage(BackendException("Request validation failed.", code = 400)),
        )
        assertEquals(
            "The video assistant could not answer. Try again.",
            chatFailureMessage(BackendException("Traceback (most recent call last):", code = 500)),
        )
        assertEquals(
            "The video assistant timed out. Try again.",
            chatFailureMessage(BackendException("The connection timed out.", code = 0, network = true)),
        )
        assertEquals(
            "Video search is unavailable right now.",
            chatFailureMessage(BackendException("Video search is unavailable right now.", code = 503)),
        )
        assertEquals(null, usableGuestKey("null"))
        assertEquals(null, usableGuestKey("short"))
        assertEquals("abcdefgh", usableGuestKey("abcdefgh"))
    }
}
