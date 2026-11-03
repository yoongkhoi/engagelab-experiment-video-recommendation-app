package com.example.engagevideopush.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class SessionStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        "engage_session",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(token: String, expiresAt: String) {
        prefs.edit().putString(TOKEN, token).putString(EXPIRES, expiresAt).apply()
    }

    fun token(): String? {
        val token = prefs.getString(TOKEN, null) ?: return null
        val expires = prefs.getString(EXPIRES, null)
        if (expires != null && isExpired(expires)) {
            clear()
            return null
        }
        return token
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private fun isExpired(value: String): Boolean {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        val date = runCatching { format.parse(value.replace("Z", "+0000")) }.getOrNull() ?: return false
        return date.time <= System.currentTimeMillis()
    }

    private companion object {
        const val TOKEN = "token"
        const val EXPIRES = "expires"
    }
}
