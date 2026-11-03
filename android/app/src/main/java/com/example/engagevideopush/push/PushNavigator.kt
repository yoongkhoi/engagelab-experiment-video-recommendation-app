package com.example.engagevideopush.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

object PushState {
    val sdkStatus = MutableStateFlow("not_started")
    val sdkCallback = MutableStateFlow("not received")
    val connected = MutableStateFlow(false)
    val backendHealth = MutableStateFlow("not checked")
    val registrationId = MutableStateFlow("")
    val deviceType = MutableStateFlow("phone")
    val authenticated = MutableStateFlow(false)
    val backendStatus = MutableStateFlow("not_contacted")
    val tagSyncStatus = MutableStateFlow("not_attempted")
    val permissionGranted = MutableStateFlow<Boolean?>(null)
    val lastError = MutableStateFlow<String?>(null)
    val note = MutableStateFlow<String?>(null)
}

object PushNavigator {
    private val _target = MutableStateFlow<ParsedPush?>(null)
    val target: StateFlow<ParsedPush?> = _target

    fun offer(parsed: ParsedPush) {
        if (!NotificationOpenDeduper.shouldHandle(parsed.dedupeKey)) return
        if (!parsed.valid) {
            PushState.lastError.value = "The notification did not include a usable video_id."
        }
        _target.value = parsed
    }

    fun consume() {
        _target.value = null
    }
}
