package com.example.engagevideopush.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import java.io.IOException

class BackendApi(initialBaseUrl: String) {
    @Volatile var baseUrl: String = initialBaseUrl.trimEnd('/')
    @Volatile var sessionToken: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .build()
    private val chatClient = client.newBuilder()
        .readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()
    private val json = "application/json".toMediaType()

    fun health(): JSONObject = get("/api/health")

    fun listVideos(path: String = "/api/videos"): List<VideoItem> {
        return VideoJson.parseList(get(path))
    }

    fun getFeed(path: String): JSONObject = get(path)

    fun getVideo(id: String): VideoItem? {
        val response = request("GET", "/api/videos/$id", null, null)
        if (response.code == 404) return null
        val body = parse(response)
        return VideoJson.parse(body.getJSONObject("video"))
    }

    fun register(
        registrationId: String,
        categories: List<String>,
        appVersion: String,
        deviceType: String,
        installationId: String,
        notificationEnabled: Boolean?,
    ): RegistrationResult {
        if (registrationId.isBlank()) {
            throw BackendException("Registration ID is empty. It was not sent.", code = 400, network = false)
        }
        val payload = JSONObject()
            .put("registrationId", registrationId)
            .put("platform", "android")
            .put("categories", JSONArray(categories))
            .put("appVersion", appVersion)
            .put("deviceType", deviceType)
            .put("installationId", installationId)
        if (notificationEnabled != null) payload.put("notificationEnabled", notificationEnabled)
        val body = post("/api/devices/register", payload, sessionToken?.let { "Bearer $it" })
        val device = body.getJSONObject("device")
        return RegistrationResult(
            deviceToken = body.getString("deviceToken"),
            tagSyncStatus = device.optString("tagSyncStatus", "unknown"),
            note = body.optString("note"),
        )
    }

    fun updatePreferences(registrationId: String, deviceToken: String, categories: List<String>) {
        val payload = JSONObject().put("categories", JSONArray(categories))
        parse(request("PUT", "/api/devices/$registrationId/preferences", payload, "Device $deviceToken"))
    }

    fun requestCode(email: String) {
        post("/api/auth/otp/request", JSONObject().put("email", email), null)
    }

    fun verifyCode(email: String, code: String): AuthSession {
        val body = post("/api/auth/otp/verify", JSONObject().put("email", email).put("code", code), null)
        return AuthSession(body.getString("token"), body.getString("expiresAt"), body.getJSONObject("user").getString("email"))
    }

    fun currentUser() {
        profile()
    }

    fun profile(): AccountProfile {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        val user = parse(request("GET", "/api/me", null, "Bearer $token")).getJSONObject("user")
        val name = user.optString("displayName").trim()
        return AccountProfile(user.getString("email"), name.ifBlank { null })
    }

    fun updateDisplayName(displayName: String): AccountProfile {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        val user = parse(request("PUT", "/api/me", JSONObject().put("displayName", displayName), "Bearer $token")).getJSONObject("user")
        val name = user.optString("displayName").trim()
        return AccountProfile(user.getString("email"), name.ifBlank { null })
    }

    fun logout() {
        val token = sessionToken ?: return
        post("/api/auth/logout", JSONObject(), "Bearer $token")
    }

    fun videoPreferences(): List<String> {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        val body = parse(request("GET", "/api/me/preferences", null, "Bearer $token"))
        val array = body.getJSONObject("preferences").optJSONArray("categories") ?: JSONArray()
        return List(array.length()) { index -> array.getString(index) }
    }

    fun saveVideoPreferences(categories: List<String>) {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        parse(request("PUT", "/api/me/preferences", JSONObject().put("categories", JSONArray(categories)), "Bearer $token"))
    }

    fun saveFavorite(video: VideoItem) {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        post("/api/me/favorites", videoPayload(video), "Bearer $token")
    }

    fun deleteFavorite(videoId: String) {
        val token = sessionToken ?: return
        parse(request("DELETE", "/api/me/favorites/$videoId", null, "Bearer $token"))
    }

    fun favorites(): List<String> = savedIds("/api/me/favorites", "favorites")

    fun recordHistory(video: VideoItem) {
        val token = sessionToken ?: return
        post("/api/me/history", videoPayload(video), "Bearer $token")
    }

    fun history(): List<String> = savedIds("/api/me/history", "history")

    fun notificationPreferences(): JSONObject {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        return parse(request("GET", "/api/me/notifications/preferences", null, "Bearer $token")).getJSONObject("preferences")
    }

    fun saveNotificationPreferences(preferences: JSONObject) {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        parse(request("PUT", "/api/me/notifications/preferences", preferences, "Bearer $token"))
    }

    fun aiChat(message: String, conversationId: String?, guestKey: String?): JSONObject {
        val payload = JSONObject().put("message", message)
        if (!conversationId.isNullOrBlank()) payload.put("conversationId", conversationId)
        val guest = if (sessionToken == null) usableGuestKey(guestKey) else null
        if (guest != null) payload.put("guestKey", guest)
        return parse(request("POST", "/api/ai/chat", payload, sessionToken?.let { "Bearer $it" }, chatClient))
    }

    fun recommendationFeedback(videoId: String, sentiment: String, conversationId: String?) {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        val payload = JSONObject().put("videoId", videoId).put("sentiment", sentiment)
        if (!conversationId.isNullOrBlank()) payload.put("conversationId", conversationId)
        post("/api/me/recommendation-feedback", payload, "Bearer $token")
    }

    private fun savedIds(path: String, field: String): List<String> {
        val token = sessionToken ?: throw BackendException("Sign in again.", code = 401, network = false)
        val array = parse(request("GET", path, null, "Bearer $token")).optJSONArray(field) ?: org.json.JSONArray()
        return List(array.length()) { index -> array.getJSONObject(index).getString("videoId") }
    }

    private fun videoPayload(video: VideoItem): JSONObject {
        val payload = JSONObject().put("videoId", video.id).put("title", video.title.ifBlank { "Video ${video.id}" }).put("category", video.category)
        if (video.thumbnailUrl?.startsWith("https://") == true) payload.put("thumbnailUrl", video.thumbnailUrl) else payload.put("thumbnailUrl", org.json.JSONObject.NULL)
        return payload
    }

    fun detachInstallation(installationId: String) {
        val token = sessionToken ?: return
        post("/api/devices/detach", JSONObject().put("installationId", installationId), "Bearer $token")
    }

    fun postEvent(deviceToken: String, event: JSONObject) {
        post("/api/events", event, "Device $deviceToken")
    }

    private fun get(path: String): JSONObject = parse(request("GET", path, null, null))

    private fun post(path: String, payload: JSONObject, authorization: String?): JSONObject {
        return parse(request("POST", path, payload, authorization))
    }

    private fun request(
        method: String,
        path: String,
        payload: JSONObject?,
        authorization: String?,
        http: OkHttpClient = client,
    ): okhttp3.Response {
        if (baseUrl.isBlank()) {
            throw BackendException(connectionFailureMessage(baseUrl, timedOut = false, unresolved = true), code = 0, network = true)
        }
        val builder = Request.Builder().url(baseUrl + path)
        if (authorization != null) builder.header("Authorization", authorization)
        if (method == "POST" || method == "PUT") {
            builder.method(method, (payload ?: JSONObject()).toString().toRequestBody(json))
        } else if (method != "GET") {
            builder.method(method, null)
        }
        return try {
            http.newCall(builder.build()).execute()
        } catch (error: IOException) {
            throw BackendException(
                connectionFailureMessage(baseUrl, error is SocketTimeoutException, error is UnknownHostException),
                code = 0,
                network = true,
            )
        }
    }

    private fun parse(response: okhttp3.Response): JSONObject {
        response.use {
            val text = it.body?.string().orEmpty()
            val body = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!it.isSuccessful) {
                val message = body.optJSONObject("error")?.optString("message") ?: "Backend request failed (${it.code})"
                throw BackendException(message, code = it.code, network = it.code >= 500)
            }
            return body
        }
    }
}

class BackendException(message: String, val code: Int = 0, val network: Boolean = false) : Exception(message)

internal fun usableGuestKey(value: String?): String? {
    val trimmed = value?.trim().orEmpty()
    return trimmed.takeIf { it.length in 8..64 }
}
