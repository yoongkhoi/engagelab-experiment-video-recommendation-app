package com.example.engagevideopush

import android.app.ActivityManager
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Process
import android.util.Log
import com.engagelab.privates.core.api.MTCorePrivatesApi
import com.engagelab.privates.push.api.MTPushPrivatesApi
import com.example.engagevideopush.data.BackendApi
import com.example.engagevideopush.data.BackendException
import com.example.engagevideopush.data.SessionStore
import com.example.engagevideopush.data.UserPreferences
import com.example.engagevideopush.data.VideoRepository
import com.example.engagevideopush.data.classifyDevice
import com.example.engagevideopush.data.looksLikeEmulator
import com.example.engagevideopush.data.resolveBackendEndpoint
import com.example.engagevideopush.push.PushState
import com.example.engagevideopush.push.engageLabRegisterHint
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
    lateinit var session: SessionStore
    lateinit var backend: BackendApi
    lateinit var repository: VideoRepository

    override fun onCreate() {
        super.onCreate()
        if (!isMainProcess()) {
            Log.i("EngagePush", "Remote process ${processName()} is starting the SDK only")
            initEngageLab(mainProcess = false)
            return
        }
        instance = this
        createChannel()
        preferences = UserPreferences(this)
        session = SessionStore(this)
        backend = BackendApi("")
        backend.sessionToken = session.token()
        PushState.authenticated.value = backend.sessionToken != null
        val deviceType = currentDeviceType()
        PushState.deviceType.value = deviceType
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
                PushState.backendHealth.value = "not configured"
                PushState.lastError.value = choice.problem
                Log.w("EngagePush", "Backend URL unavailable for $deviceType")
            } else {
                backend.baseUrl = choice.url
                if (choice.url != saved.trimEnd('/')) preferences.saveBackendUrl(choice.url)
                Log.i("EngagePush", "Backend URL ${choice.url} for $deviceType")
                probeBackend()
            }
        }
        initEngageLab(mainProcess = true)
        scope.launch { watchSdkConnection() }
    }

    fun refreshRegistrationId() {
        if (!isMainProcess() || !::backend.isInitialized) return
        probeBackend()
        if (BuildConfig.ENGAGELAB_APPKEY.length != 24) return
        val registrationId = runCatching { MTCorePrivatesApi.getRegistrationId(this) }.getOrNull()
        if (registrationId.isNullOrBlank()) {
            val snapshot = sdkSnapshot()
            Log.i("EngagePush", "Refresh found no Registration ID. $snapshot")
            if (PushState.connected.value) {
                PushState.lastError.value = "onConnectStatus is true, but getRegistrationId is empty. $snapshot"
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
        PushState.backendStatus.value = "not_contacted"
        PushState.note.value = "A real Registration ID is available. Sending it to the backend."
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
                    PushState.backendStatus.value = "contacting"
                    Log.i("EngagePush", "POST /api/devices/register attempt ${attempt + 1} length=${registrationId.length}")
                    val result = backend.register(
                        registrationId,
                        preferences.categories(),
                        BuildConfig.APP_VERSION_NAME,
                        deviceType,
                        installationId,
                        PushState.permissionGranted.value,
                    )
                    preferences.saveDeviceToken(result.deviceToken)
                    PushState.backendStatus.value = "stored"
                    PushState.tagSyncStatus.value = result.tagSyncStatus
                    PushState.note.value = result.note
                    PushState.lastError.value = null
                    Log.i("EngagePush", "Registration ID stored. tagSync=${result.tagSyncStatus}")
                    return
                } catch (error: BackendException) {
                    PushState.backendStatus.value = if (error.network) "unreachable" else "rejected"
                    PushState.lastError.value = error.message
                    Log.w("EngagePush", "Registration attempt ${attempt + 1} failed. network=${error.network} http=${error.code}")
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

    private fun initEngageLab(mainProcess: Boolean) {
        val appKey = BuildConfig.ENGAGELAB_APPKEY
        val site = BuildConfig.ENGAGELAB_APP_SITE
        if (appKey.length != 24) {
            if (mainProcess) {
                PushState.sdkStatus.value = "not_configured"
                PushState.lastError.value = "AppKey is missing from engagelab.properties. The SDK was not initialized and no Registration ID will be created."
            }
            Log.w("EngagePush", "AppKey missing. SDK init skipped. mainProcess=$mainProcess")
            return
        }
        if (mainProcess) PushState.sdkStatus.value = "initializing"
        MTCorePrivatesApi.configDebugMode(this, BuildConfig.DEBUG)
        MTCorePrivatesApi.configAppKey(this, appKey)
        if (site.isNotBlank()) MTCorePrivatesApi.configAppSiteName(this, site)
        MTPushPrivatesApi.init(this)
        if (mainProcess) {
            PushState.sdkStatus.value = "initialized"
            PushState.note.value = "MTPushPrivatesApi.init returned. Waiting for onConnectStatus. Initialized is not connected."
        }
        Log.i("EngagePush", "MTPushPrivatesApi.init returned. mainProcess=$mainProcess site=${site.ifBlank { "unset" }} appKeyLength=${appKey.length}")
    }

    private suspend fun watchSdkConnection() {
        delay(20_000)
        reportMissingRegistration("20s")
        if (PushState.registrationId.value.isNotBlank()) return
        delay(20_000)
        reportMissingRegistration("40s")
    }

    private fun reportMissingRegistration(elapsed: String) {
        if (PushState.registrationId.value.isNotBlank()) return
        val snapshot = sdkSnapshot()
        val registerCode = runCatching { MTCorePrivatesApi.getRegisterCode(this) }.getOrDefault(-1)
        val message = "No Registration ID after $elapsed. ${engageLabRegisterHint(this, registerCode)} POST /api/devices/register was not sent. $snapshot"
        PushState.lastError.value = message
        Log.w("EngagePush", message)
    }

    private fun probeBackend() {
        if (!::backend.isInitialized) return
        scope.launch {
            val url = backend.baseUrl
            if (url.isBlank()) {
                PushState.backendHealth.value = "not configured"
                return@launch
            }
            PushState.backendHealth.value = "checking $url/api/health"
            try {
                val body = backend.health()
                val ok = body.optBoolean("ok")
                PushState.backendHealth.value = if (ok) "ok" else "unexpected response"
                Log.i("EngagePush", "GET /api/health completed ok=$ok url=$url")
                if (PushState.registrationId.value.isBlank() && PushState.backendStatus.value == "not_contacted") {
                    PushState.note.value = "Backend health succeeded. Device registration is still waiting for a Registration ID from the SDK."
                }
            } catch (error: Exception) {
                PushState.backendHealth.value = "failed"
                PushState.lastError.value = error.message ?: "Backend health check failed."
                Log.w("EngagePush", "GET /api/health failed url=$url")
            }
        }
    }

    private fun sdkSnapshot(): String {
        val registerCode = runCatching { MTCorePrivatesApi.getRegisterCode(this) }.getOrDefault(-1)
        val loginCode = runCatching { MTCorePrivatesApi.getLoginCode(this) }.getOrDefault(-1)
        val length = runCatching { MTCorePrivatesApi.getRegistrationId(this)?.length ?: 0 }.getOrDefault(0)
        return "registerCode=$registerCode loginCode=$loginCode registrationLength=$length callback=${PushState.sdkCallback.value}"
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

    private fun isMainProcess(): Boolean {
        return processName() == packageName
    }

    private fun processName(): String {
        if (Build.VERSION.SDK_INT >= 28) return Application.getProcessName()
        val pid = Process.myPid()
        val manager = getSystemService(ActivityManager::class.java)
        return manager.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName ?: packageName
    }

    companion object {
        const val CHANNEL_ID = "engage_video_push"
        lateinit var instance: EngageApplication
            private set
    }
}

