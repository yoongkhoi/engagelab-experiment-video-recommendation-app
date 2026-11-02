package com.example.engagevideopush

import com.example.engagevideopush.data.EndpointInput
import com.example.engagevideopush.data.classifyDevice
import com.example.engagevideopush.data.connectionFailureMessage
import com.example.engagevideopush.data.looksLikeEmulator
import com.example.engagevideopush.data.resolveBackendEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackendEndpointTest {
    @Test
    fun emulatorUsesTheHostLoopbackEvenWhenALanAddressWasSaved() {
        val choice = resolveBackendEndpoint(EndpointInput(true, "192.168.1.106", "3000", "http://192.168.1.106:3000"))
        assertEquals("http://10.0.2.2:3000", choice.url)
        assertNull(choice.problem)
    }

    @Test
    fun phoneAndTabletUseTheLanAddressInsteadOfLoopback() {
        val phone = resolveBackendEndpoint(EndpointInput(false, "192.168.1.106", "3000", "http://10.0.2.2:3000"))
        val tablet = resolveBackendEndpoint(EndpointInput(false, "192.168.1.106", "3000", "http://127.0.0.1:3000"))
        assertEquals("http://192.168.1.106:3000", phone.url)
        assertEquals("http://192.168.1.106:3000", tablet.url)
    }

    @Test
    fun aSavedLanAddressOnAPhysicalDeviceIsKept() {
        val choice = resolveBackendEndpoint(EndpointInput(false, "10.0.0.8", "3000", "http://192.168.1.50:3000"))
        assertEquals("http://192.168.1.50:3000", choice.url)
    }

    @Test
    fun aPhysicalDeviceWithoutALanAddressGetsAnActionableError() {
        val choice = resolveBackendEndpoint(EndpointInput(false, "", "3000", "http://10.0.2.2:3000"))
        assertEquals("", choice.url)
        assertTrue(choice.problem!!.contains("10.0.2.2"))
    }

    @Test
    fun deviceClassSeparatesEmulatorPhoneAndTablet() {
        assertEquals("emulator", classifyDevice(true, 800))
        assertEquals("phone", classifyDevice(false, 411))
        assertEquals("tablet", classifyDevice(false, 800))
        assertTrue(looksLikeEmulator("generic", "sdk_gphone64", "ranchu", "sdk_gphone64_arm64"))
    }

    @Test
    fun connectionErrorsNameTheUrlInsteadOfWaitingSilently() {
        val message = connectionFailureMessage("http://10.0.2.2:3000", timedOut = true, unresolved = false)
        assertTrue(message.contains("timed out"))
        assertTrue(message.contains("http://10.0.2.2:3000"))
    }
}
