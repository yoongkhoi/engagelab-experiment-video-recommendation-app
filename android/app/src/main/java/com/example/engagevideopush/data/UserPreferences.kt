package com.example.engagevideopush.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.util.UUID

private val Context.dataStore by preferencesDataStore("engage_video_push")

class UserPreferences(private val context: Context) {
    suspend fun categories(): List<String> {
        val raw = context.dataStore.data.first()[categoriesKey]
        return raw?.split(',')?.filter { it.isNotBlank() } ?: listOf("tech", "funny", "lifestyle")
    }

    suspend fun setCategories(categories: List<String>) {
        context.dataStore.edit { prefs -> prefs[categoriesKey] = categories.joinToString(",") }
    }

    suspend fun deviceToken(): String? = context.dataStore.data.first()[tokenKey]

    suspend fun saveDeviceToken(token: String) {
        context.dataStore.edit { prefs -> prefs[tokenKey] = token }
    }

    suspend fun backendUrl(defaultUrl: String): String = context.dataStore.data.first()[backendKey] ?: defaultUrl

    suspend fun saveBackendUrl(url: String) {
        context.dataStore.edit { prefs -> prefs[backendKey] = url.trimEnd('/') }
    }

    suspend fun installationId(): String {
        val existing = context.dataStore.data.first()[installationKey]
        if (!existing.isNullOrBlank()) return existing
        val created = UUID.randomUUID().toString().replace("-", "")
        context.dataStore.edit { prefs -> prefs[installationKey] = created }
        return created
    }

    private companion object {
        val categoriesKey = stringPreferencesKey("categories")
        val tokenKey = stringPreferencesKey("device_token")
        val backendKey = stringPreferencesKey("backend_url")
        val installationKey = stringPreferencesKey("installation_id")
    }
}
