package com.example.engagevideopush.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.libraryStore by preferencesDataStore("engage_library")

class LibraryStore(private val context: Context) {
    suspend fun favorites(): List<String> = read(favoritesKey)

    suspend fun isFavorite(id: String): Boolean = id in favorites()

    suspend fun toggleFavorite(id: String): Boolean {
        val current = favorites().filter { it != id }
        val saved = id !in favorites()
        val next = if (saved) listOf(id) + current else current
        write(favoritesKey, next)
        return saved
    }

    suspend fun watched(): List<String> = read(watchedKey)

    suspend fun replaceFavorites(ids: List<String>) {
        write(favoritesKey, ids.distinct())
    }

    suspend fun replaceWatched(ids: List<String>) {
        write(watchedKey, ids.distinct().take(24))
    }

    suspend fun guestKey(): String? = context.libraryStore.data.first()[guestKeyPref]

    suspend fun saveGuestKey(value: String) {
        context.libraryStore.edit { prefs -> prefs[guestKeyPref] = value }
    }

    suspend fun rememberWatched(id: String) {
        if (id.isBlank()) return
        val next = listOf(id) + watched().filter { it != id }
        write(watchedKey, next.take(24))
    }

    private suspend fun read(key: androidx.datastore.preferences.core.Preferences.Key<String>): List<String> {
        val raw = context.libraryStore.data.first()[key]
        return raw?.split(',')?.filter { it.isNotBlank() } ?: emptyList()
    }

    private suspend fun write(key: androidx.datastore.preferences.core.Preferences.Key<String>, ids: List<String>) {
        context.libraryStore.edit { prefs -> prefs[key] = ids.joinToString(",") }
    }

    private companion object {
        val favoritesKey = stringPreferencesKey("favorite_ids")
        val watchedKey = stringPreferencesKey("watched_ids")
        val guestKeyPref = stringPreferencesKey("ai_guest_key")
    }
}
