package com.example.engagevideopush

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log
import com.engagelab.privates.core.api.MTCorePrivatesApi
import com.engagelab.privates.push.api.MTPushPrivatesApi
import com.example.engagevideopush.data.BackendApi
import com.example.engagevideopush.data.BackendException
import com.example.engagevideopush.data.UserPreferences
import com.example.engagevideopush.data.VideoRepository
import com.example.engagevideopush.data.classifyDevice
import com.example.engagevideopush.data.looksLikeEmulator
import com.example.engagevideopush.data.resolveBackendEndpoint
import com.example.engagevideopush.push.PushState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class EngageApplication : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val registrationLock = Mutex()
    lateinit var preferences: UserPreferences
    lateinit var backend: BackendApi
    lateinit var repository: VideoRepository

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
        preferences = UserPreferences(this)
        val deviceType = currentDeviceType()
        PushState.deviceType.value = deviceType
        backend = BackendApi("")
        repository = VideoRepository(this, backend)
        scope.launch {
            val saved = preferences.backendUrl("")
            val choice = resolveBackendEndpoint(
                com.example.engagevideopush.data.EndpointInput(
                    emulator = isEmulator(),
                    lanHost = BuildConfig.BACKEND_LAN_HOST,
                    port = BuildConfig.BACKEND_PORT,
                    savedUrl = saved,
                ),
            )
            if (choice.url.isBlank()) {
                PushState.backendStatus.value = "error"
                PushState.lastError.value = choice.problem
                Log.w("EngagePush", "Backend URL unavailable for $deviceType")
            } else {
                backend.baseUrl = choice.url
                if (choice.url != saved.trimEnd('/')) preferences.saveBackendUrl(choice.url)
                Log.i("EngagePush", "Backend URL ${choice.url} for $deviceType")
            }
        }
        val appKey = BuildConfig.ENGAGELAB_APPKEY
        if (appKey.length == 24) {
            PushState.sdkStatus.value = "initializing"
            MTCorePrivatesApi.configDebugMode(this, BuildConfig.DEBUG)
            MTCorePrivatesApi.configAppKey(this, appKey)
            if (BuildConfig.ENGAGELAB_APP_SITE.isNotBlank()) {
                MTCorePrivatesApi.configAppSiteName(this, BuildConfig.ENGAGELAB_APP_SITE)
            }
            MTPushPrivatesApi.init(this)
            PushState.sdkStatus.value = "initialized"
        } else {
            PushState.sdkStatus.value = "not_configured"
            PushState.lastError.value = "AppKey is missing from engagelab.properties. The SDK was not initialized and no Registration ID will be created."
        }
    }

    fun refreshRegistrationId() {
        if (BuildConfig.ENGAGELAB_APPKEY.length != 24) return
        val registrationId = MTCorePrivatesApi.getRegistrationId(this)
        if (registrationId.isNullOrBlank()) {
            if (PushState.connected.value) {
                PushState.lastError.value = "Registration ID is empty. The SDK is connected, but no ID was available to store."
            }
            return
        }
        onRegistrationId(registrationId)
    }

    fun onRegistrationId(registrationId: String) {
        if (registrationId.isBlank()) {
            Log.i("EngagePush", "Ignored an empty Registration ID")
            return
        }
        PushState.registrationId.value = registrationId
        Log.i("EngagePush", "Registration ID is available. length=${registrationId.length} device=${currentDeviceType()}")
        scope.launch { registerWithRetry(registrationId) }
    }

    private suspend fun registerWithRetry(registrationId: String) {
        registrationLock.withLock {
            if (registrationId.isBlank() || registrationId != PushState.registrationId.value) return
            val installationId = preferences.installationId()
            val deviceType = currentDeviceType()
            var waitMs = 1_000L
            repeat(3) { attempt ->
                if (backend.baseUrl.isBlank()) {
                    PushState.backendStatus.value = "error"
                    PushState.lastError.value = PushState.lastError.value ?: "Backend URL is not configured."
                    delay(waitMs)
                    return@repeat
                }
                try {
                    val result = backend.register(
                        registrationId,
                        preferences.categories(),
                        BuildConfig.APP_VERSION_NAME,
                        deviceType,
                        installationId,
                    )
                    preferences.saveDeviceToken(result.deviceToken)
                    PushState.backendStatus.value = "stored"
                    PushState.tagSyncStatus.value = result.tagSyncStatus
                    PushState.note.value = result.note
                    PushState.lastError.value = null
                    Log.i("EngagePush", "Registration ID stored. tagSync=${result.tagSyncStatus}")
                    return
                } catch (error: BackendException) {
                    PushState.backendStatus.value = "error"
                    PushState.lastError.value = error.message
                    Log.w("EngagePush", "Registration attempt ${attempt + 1} failed. network=${error.network}")
                    if (!error.network || attempt == 2) return
                    delay(waitMs)
                    waitMs = (waitMs * 2).coerceAtMost(8_000L)
                } catch (error: Exception) {
                    PushState.backendStatus.value = "error"
                    PushState.lastError.value = error.message ?: "Device registration failed."
                    return
                }
            }
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH,
        )
        channel.description = getString(R.string.notification_channel_description)
        manager.createNotificationChannel(channel)
    }

    private fun currentDeviceType(): String {
        return classifyDevice(isEmulator(), resources.configuration.smallestScreenWidthDp)
    }

    private fun isEmulator(): Boolean {
        return looksLikeEmulator(Build.FINGERPRINT, Build.MODEL, Build.HARDWARE, Build.PRODUCT)
    }

    companion object {
        const val CHANNEL_ID = "engage_video_push"
        lateinit var instance: EngageApplication
            private set
    }
}

